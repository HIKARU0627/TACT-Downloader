chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === "visit_and_download") {
    const { startUrl, folders } = message;
    const allLinks = new Set();

    // 現在のページを含めて再帰処理
    const targets = [startUrl, ...folders];

    for (const url of targets) {
      const tab = await chrome.tabs.create({ url, active: false });
      await waitForLoad(tab.id);

      const links = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: collectFileLinks
      });

      chrome.tabs.remove(tab.id);

      for (const link of links[0].result) allLinks.add(link);
    }

    // 取得した全ファイルをダウンロード
    for (const fileUrl of allLinks) {
      const downloadUrl = fileUrl.includes("?")
        ? fileUrl + "&attachment=true"
        : fileUrl + "?attachment=true";
      const filename = decodeURIComponent(downloadUrl.split("/").pop().split("?")[0]);
      await chrome.downloads.download({ url: downloadUrl, filename, saveAs: false });
    }

    sendResponse({ status: "done", count: allLinks.size });
  }
});

// ページ読み込み待機関数
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

// ページ内スクリプトとして実行される関数
function collectFileLinks() {
  return Array.from(document.querySelectorAll("a[href]"))
    .map(a => a.href)
    .filter(href => /\.(pdf|pptx|docx|xlsx|zip|csv|txt|jpg|png)$/i.test(href));
}
