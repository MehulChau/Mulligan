import { clubAvailability, lieRestrictionSummary, type SurfaceType } from "@mulligan/game";
import type { ClubId, ClubProfile } from "@mulligan/shot-source";

export interface ClubPickerProps {
  clubs: readonly ClubProfile[];
  selectedClubId: ClubId;
  surface: SurfaceType;
  disabled?: boolean;
  onSelect: (clubId: ClubId) => void;
}

export function ClubPicker({ clubs, selectedClubId, surface, disabled, onSelect }: ClubPickerProps) {
  const restrictionCaption = lieRestrictionSummary(surface);

  return (
    <div>
      {restrictionCaption && <div className="lie-caption">{restrictionCaption}</div>}
      <div className="clubs">
        {clubs.map((club) => {
          const availability = clubAvailability(surface, club.id);
          return (
            <button
              key={club.id}
              type="button"
              className={"club" + (club.id === selectedClubId ? " on" : "") + (availability.available ? "" : " unavailable")}
              disabled={disabled || !availability.available}
              title={availability.reason}
              onClick={() => onSelect(club.id)}
            >
              {club.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
