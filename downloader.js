// ====== コンテキストメニュー登録 ======
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "tact-download",
    title: "TACTの資料をダウンロード",
    contexts: ["page"]
  });
  chrome.contextMenus.create({
    id: "tact-bulk",
    title: "複数授業を一括ダウンロード",
    contexts: ["action"]
  });
});

// ====== メニュークリック / アイコンクリック ======
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "tact-download") await handleTactDownload(tab);
  if (info.menuItemId === "tact-bulk") await handleBulkDownload(tab);
});

chrome.action.onClicked.addListener(async (tab) => {
  await handleTactDownload(tab);
});

// ====== 単一授業ダウンロード（既存動作） ======
async function handleTactDownload(tab) {
  const url = tab.url || "";

  const portalMatch = url.match(/https:\/\/tact\.ac\.thers\.ac\.jp\/portal\/site\/(n_\d{4}_\d{7})\/?/);
  if (portalMatch) {
    const courseId = portalMatch[1];
    const resourceUrl = `https://tact.ac.thers.ac.jp/access/content/group/${courseId}/`;
    await chrome.tabs.create({ url: resourceUrl, active: true });
    return;
  }

  const resourceMatch = url.match(/https:\/\/tact\.ac\.thers\.ac\.jp\/access\/content\/group\/(n_\d{4}_\d{7})\/?/);
  if (resourceMatch) {
    const ok = await tabConfirm(tab.id, "この授業の全ファイルを再帰的にダウンロードしますか？");
    if (!ok) return;
    await visitAndDownload(url, tab.id);
    return;
  }

  await tabAlert(tab.id, "TACTの授業ページまたはリソースページで実行してください。");
}

// ====== 複数授業一括ダウンロード ======
async function handleBulkDownload(tab) {
  // タブ上で入力 or ファイル選択を促す
  const [{ result: inputMode }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => prompt(
      "複数授業を一括ダウンロードします。\n\n" +
      "・授業IDをカンマ区切りで入力\n　例: n_2025_1000171,n_2024_1000030\n" +
      "・または空欄でOKを押すと.txtファイルを選択できます。"
    )
  });

  let ids = [];

  if (inputMode && inputMode.trim().length > 0) {
    ids = inputMode.split(",").map(s => s.trim()).filter(Boolean);
  } else {
    // ファイルから読み込み
    const [{ result: fileIds }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        return new Promise((resolve) => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".txt";
          input.onchange = async (e) => {
            const file = e.target.files[0];
            const text = await file.text();
            const ids = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            resolve(ids);
          };
          input.click();
        });
      }
    });
    ids = fileIds || [];
  }

  if (!ids.length) {
    await tabAlert(tab.id, "授業IDが指定されていません。");
    return;
  }

  const confirmMsg = `${ids.length}件の授業を一括ダウンロードします。よろしいですか？`;
  const ok = await tabConfirm(tab.id, confirmMsg);
  if (!ok) return;

  for (const id of ids) {
    const resourceUrl = `https://tact.ac.thers.ac.jp/access/content/group/${id}/`;
    await visitAndDownload(resourceUrl, tab.id);
  }

  await tabAlert(tab.id, "✅ 全ての授業のダウンロードが完了しました。");
}

// ====== UIヘルパー ======
async function tabConfirm(tabId, message) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (msg) => confirm(msg),
    args: [message],
  });
  return !!result;
}

async function tabAlert(tabId, message) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (msg) => alert(msg),
    args: [message],
  });
}

// ====== ページ解析 & ダウンロード処理 ======
function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function collectLinksAndFolders() {
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const abs = anchors.map(a => new URL(a.href, location.href).href);
  const folders = abs.filter(href => href.endsWith("/"));
  const files = abs.filter(href => /\.(pdf|pptx|docx|xlsx|zip|csv|txt|jpg|png|c|cpp|py)$/i.test(href));
  return { folders: [...new Set(folders)], files: [...new Set(files)] };
}

async function visitAndDownload(startUrl, uiTabId) {
  const allFiles = [];
  const visited = new Set();
  let rootFolderName = "TACT_Class";

  const headTab = await chrome.tabs.create({ url: startUrl, active: false });
  await waitForLoad(headTab.id);
  const [{ result: className }] = await chrome.scripting.executeScript({
    target: { tabId: headTab.id },
    func: () => {
      const h3 = document.querySelector("h3");
      return h3 ? h3.textContent.trim().replace(/[\\/:*?"<>|]/g, "_") : "TACT_Class";
    },
  });
  rootFolderName = className || "TACT_Class";
  await chrome.tabs.remove(headTab.id);

  async function processFolder(url, prefix = "") {
    if (visited.has(url)) return;
    visited.add(url);

    const tab = await chrome.tabs.create({ url, active: false });
    await waitForLoad(tab.id);
    const [{ result: links }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectLinksAndFolders,
    });
    await chrome.tabs.remove(tab.id);

    for (const sub of links.folders) {
      const folderName = decodeURIComponent(sub.split("/").filter(Boolean).pop());
      await processFolder(sub, `${prefix}${folderName}/`);
    }

    for (const file of links.files) {
      const baseName = decodeURIComponent(file.split("/").pop().split("?")[0]);
      allFiles.push({
        url: file,
        path: `${rootFolderName}/${prefix}${baseName}`,
      });
    }
  }

  await processFolder(startUrl);

  for (const file of allFiles) {
    const downloadUrl = file.url.includes("?")
      ? file.url + "&attachment=true"
      : file.url + "?attachment=true";
    await chrome.downloads.download({
      url: downloadUrl,
      filename: file.path,
      saveAs: false,
    });
  }

  await tabAlert(uiTabId, `✅ ${rootFolderName} に ${allFiles.length} 個のファイルを保存しました。`);
}
