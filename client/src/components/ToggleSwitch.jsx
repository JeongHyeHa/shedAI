import './ToggleSwitch.css';

export default function ToggleSwitch({ checked, onChange, leftLabel, rightLabel }) {
  return (
    <div className="custom-toggle-switch" onClick={onChange}>
      <div className={`toggle-option left ${checked ? 'active' : ''}`}>{leftLabel}</div>
      <div className={`toggle-option right ${!checked ? 'active' : ''}`}>{rightLabel}</div>
      <div className={`toggle-slider ${checked ? 'left' : 'right'}`}></div>
    </div>
  );
} 