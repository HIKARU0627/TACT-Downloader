(() => {
  if (!confirm("このフォルダ以下のすべてのファイルをダウンロードしますか？")) return;

  chrome.runtime.sendMessage({
    action: "visit_and_download",
    startUrl: location.href
  });

  alert("✅ ダウンロード処理をバックグラウンドで開始しました。");
})();
