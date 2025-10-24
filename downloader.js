// ====== コンテキストメニュー登録 ======
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "tact-download",
    title: "TACTの資料をダウンロード",
    contexts: ["page"]
  });
});

// ====== 右クリックメニューから実行 ======
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "tact-download") {
    await handleTactDownload(tab);
  }
});

// ====== アイコンクリックからも同じ処理 ======
chrome.action.onClicked.addListener(async (tab) => {
  await handleTactDownload(tab);
});

// ====== メイン処理（授業ページ or リソースページ） ======
async function handleTactDownload(tab) {
  const url = tab.url || "";

  // 授業ページならリソースページへ移動
  const portalMatch = url.match(/https:\/\/tact\.ac\.thers\.ac\.jp\/portal\/site\/(n_\d{4}_\d{7})\/?/);
  if (portalMatch) {
    const courseId = portalMatch[1];
    const resourceUrl = `https://tact.ac.thers.ac.jp/access/content/group/${courseId}/`;
    await chrome.tabs.create({ url: resourceUrl, active: true });
    return;
  }

  // リソースページならダウンロード開始
  const resourceMatch = url.match(/https:\/\/tact\.ac\.thers\.ac\.jp\/access\/content\/group\/(n_\d{4}_\d{7})\/?/);
  if (resourceMatch) {
    const ok = await tabConfirm(tab.id, "この授業の全ファイルを再帰的にダウンロードしますか？");
    if (!ok) return;
    await visitAndDownload(url, tab.id);
    return;
  }

  await tabAlert(tab.id, "TACTの授業ページまたはリソースページで実行してください。");
}

// ====== タブ上でUIを出す関数 ======
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

// ====== ページ読み込み待ち ======
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

// ====== ページ内解析 ======
function collectLinksAndFolders() {
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const abs = anchors.map(a => new URL(a.href, location.href).href);
  const folders = abs.filter(href => href.endsWith("/"));
  const files = abs.filter(href => /\.(pdf|pptx|docx|xlsx|zip|csv|txt|jpg|png)$/i.test(href));
  return { folders: [...new Set(folders)], files: [...new Set(files)] };
}

// ====== 再帰ダウンロード本体 ======
async function visitAndDownload(startUrl, uiTabId) {
  const allFiles = [];
  const visited = new Set();
  let rootFolderName = "TACT_Class";

  // 授業名を取得
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

  // 再帰的にフォルダ探索
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
