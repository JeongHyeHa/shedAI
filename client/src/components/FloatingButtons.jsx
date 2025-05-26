import React from "react";
import "../styles/floating.css"; 
import smileIcon from "../assets/smile.png";
import pencilIcon from "../assets/pencil.png";
import plusIcon from "../assets/plus.png";

function FloatingButtons({ onClickPlus, onClickPencil }) {
  return (
    <div className="floating-buttons">
      <button className="float-btn"><img src={smileIcon} alt="Smile" /></button>
      <button className="float-btn" onClick={onClickPencil}><img src={pencilIcon} alt="Pencil" /></button>
      <button className="float-btn" onClick={onClickPlus}><img src={plusIcon} alt="Plus" /></button>
    </div>
  );
}

export default FloatingButtons;
