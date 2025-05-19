import React from "react";
import "../styles/floating.css"; // 버튼 스타일

function FloatingButtons() {
  return (
    <div className="floating-buttons">
      <button className="float-btn yellow">😊</button>
      <button className="float-btn green">✏️</button>
      <button className="float-btn red">➕</button>
    </div>
  );
}

export default FloatingButtons;
