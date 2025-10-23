chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === "visit_and_download") {
    const { startUrl } = message;
    const allFiles = [];
    const visited = new Set();
    let rootFolderName = "TACT_Resources";

    // 最初に授業名を取得
    const tab = await chrome.tabs.create({ url: startUrl, active: false });
    await waitForLoad(tab.id);
    const [{ result: className }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const h3 = document.querySelector("h3");
        if (h3) return h3.textContent.trim().replace(/[\\/:*?"<>|]/g, "_"); // 禁止文字除去
        return "TACT_Class";
      }
    });
    rootFolderName = className;
    chrome.tabs.remove(tab.id);

    async function processFolder(url, prefix = "") {
      if (visited.has(url)) return;
      visited.add(url);

      const tab = await chrome.tabs.create({ url, active: false });
      await waitForLoad(tab.id);

      const [{ result: links }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: collectLinksAndFolders
      });

      chrome.tabs.remove(tab.id);

      // サブフォルダを再帰的に処理
      for (const sub of links.folders) {
        const folderName = decodeURIComponent(sub.split("/").filter(Boolean).pop());
        await processFolder(sub, prefix + folderName + "/");
      }

      // ファイルを登録
      for (const file of links.files) {
        allFiles.push({
          url: file,
          path: `${rootFolderName}/${prefix}${decodeURIComponent(file.split("/").pop().split("?")[0])}`
        });
      }
    }

    await processFolder(startUrl);

    // すべてのファイルをダウンロード
    for (const file of allFiles) {
      const downloadUrl = file.url.includes("?")
        ? file.url + "&attachment=true"
        : file.url + "?attachment=true";

      await chrome.downloads.download({
        url: downloadUrl,
        filename: file.path,
        saveAs: false
      });
    }

    alert(`✅ ${rootFolderName} フォルダ内に ${allFiles.length} 個のファイルをダウンロードしました。`);
    sendResponse({ status: "done", count: allFiles.length });
  }
});

// 読み込み完了待機
function waitForLoad(tabId) {
  return new Promise(resolve => {
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ページ内で実行される関数（DOMを解析）
function collectLinksAndFolders() {
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const folders = anchors
    .map(a => new URL(a.href, location.href).href)
    .filter(href => href.endsWith("/"));
  const files = anchors
    .map(a => new URL(a.href, location.href).href)
    .filter(href => /\.(pdf|pptx|docx|xlsx|zip|csv|txt|jpg|png)$/i.test(href));
  return { folders: [...new Set(folders)], files: [...new Set(files)] };
}
