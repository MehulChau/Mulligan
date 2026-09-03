import type { ClubId, ClubProfile } from "@mulligan/shot-source";

export interface ClubPickerProps {
  clubs: readonly ClubProfile[];
  selectedClubId: ClubId;
  onSelect: (clubId: ClubId) => void;
}

export function ClubPicker({ clubs, selectedClubId, onSelect }: ClubPickerProps) {
  return (
    <div className="clubs">
      {clubs.map((club) => (
        <button
          key={club.id}
          type="button"
          className={"club" + (club.id === selectedClubId ? " on" : "")}
          onClick={() => onSelect(club.id)}
        >
          {club.name}
        </button>
      ))}
    </div>
  );
}
