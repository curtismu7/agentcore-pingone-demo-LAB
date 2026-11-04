// A button that is "off" stays in the tab order and keeps focus (aria-disabled instead of disabled), and does nothing when pressed.
// Shared stylesheet: button:disabled is dimmed there; app.css dims button[aria-disabled="true"] the same way.
export default function ActionButton({ off = false, onClick, children, ...rest }) {
  return (
    <button type="button" aria-disabled={off ? "true" : undefined} onClick={(e) => { if (off) { e.preventDefault(); return; } if (onClick) onClick(e); }} {...rest}>
      {children}
    </button>
  );
}
