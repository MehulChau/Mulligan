export interface TopBarProps {
  holeName: string;
  par: number;
  strokeNumber: number;
  onOpenSettings: () => void;
  connectionDotClassName: string;
}

/**
 * Deliberately quiet -- this is context, not the thing the player is
 * looking at. Hole/par on the left, shot count on the right, a hairline
 * border underneath to separate it from the distance hero without adding
 * visual weight of its own.
 */
export function TopBar({ holeName, par, strokeNumber, onOpenSettings, connectionDotClassName }: TopBarProps) {
  return (
    <div className="topbar">
      <span className="topbar-left">
        {holeName} <span className="topbar-dim">· Par {par}</span>
      </span>
      <span className="topbar-right">
        <span className="topbar-dim">Shot {strokeNumber}</span>
        <button type="button" className="topbar-settings" onClick={onOpenSettings} aria-label="Settings">
          <span className={"conn-dot " + connectionDotClassName} />
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="1.6" fill="currentColor" />
            <circle cx="8" cy="2.6" r="1.4" fill="currentColor" />
            <circle cx="8" cy="13.4" r="1.4" fill="currentColor" />
            <circle cx="2.6" cy="8" r="1.4" fill="currentColor" />
            <circle cx="13.4" cy="8" r="1.4" fill="currentColor" />
          </svg>
        </button>
      </span>
    </div>
  );
}
