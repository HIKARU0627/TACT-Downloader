(() => {
  const folderLinks = Array.from(document.querySelectorAll("li.folder > a[href]"))
    .map(a => new URL(a.getAttribute("href"), location.href).href);

  if (folderLinks.length === 0) {
    alert("フォルダが見つかりません。");
    return;
  }

  if (!confirm(`${folderLinks.length}個のフォルダを自動巡回してダウンロードしますか？`)) return;

  chrome.runtime.sendMessage({
    action: "visit_and_download",
    startUrl: location.href,
    folders: folderLinks
  });

  alert("✅ ダウンロード処理をバックグラウンドで開始しました。");
})();
