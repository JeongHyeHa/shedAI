import React from "react";
import "../styles/floating.css"; // 버튼 스타일
import smileIcon from "../assets/smile.png";
import pencilIcon from "../assets/pencil.png";
import plusIcon from "../assets/plus.png";

function FloatingButtons() {
  return (
    <div className="floating-buttons">
      <button className="float-btn"><img src={smileIcon} alt="Smile" /></button>
      <button className="float-btn"><img src={pencilIcon} alt="Pencil" /></button>
      <button className="float-btn"><img src={plusIcon} alt="Plus" /></button>
    </div>
  );
}

export default FloatingButtons;
