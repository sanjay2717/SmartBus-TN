export default function LiveCameraTag({ ai_ok, connected, stale }) {
  const showSubtext = (ai_ok === false) || stale || !connected;

  return (
    <div className="live-tag-wrap">
      <span className="live-tag">LIVE (camera)</span>
      {showSubtext && (
        <span className="live-tag-sub">The AI model is not available.</span>
      )}
    </div>
  );
}
