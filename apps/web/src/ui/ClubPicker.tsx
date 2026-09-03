import type { ClubId, ClubProfile } from "@mulligan/shot-source";

export interface ClubPickerProps {
  clubs: readonly ClubProfile[];
  selectedClubId: ClubId;
  disabled?: boolean;
  onSelect: (clubId: ClubId) => void;
}

export function ClubPicker({ clubs, selectedClubId, disabled, onSelect }: ClubPickerProps) {
  return (
    <div className="clubs">
      {clubs.map((club) => (
        <button
          key={club.id}
          type="button"
          className={"club" + (club.id === selectedClubId ? " on" : "")}
          disabled={disabled}
          onClick={() => onSelect(club.id)}
        >
          {club.name}
        </button>
      ))}
    </div>
  );
}
