import type { ResourceKind } from '../generated/contracts';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { useGameEntityAsset } from './useGameEntityAsset';
export { portraitCatalogueVersion } from './useGameEntityAsset';
export function GameEntityIcon({
  kind,
  id,
  version,
  label,
  className = '',
  showTitle = true,
}: {
  kind: ResourceKind;
  id: number | null | undefined;
  version?: string | null;
  label: string;
  className?: string;
  showTitle?: boolean;
}) {
  const artwork = useGameEntityAsset(kind, id, version);
  return (
    <Avatar
      className={`size-8 shrink-0 rounded-md ${className}`}
      title={showTitle ? label : undefined}
    >
      <AvatarImage
        src={artwork.data?.[0]?.reference || undefined}
        alt={label}
        className="object-cover"
      />
      <AvatarFallback className="rounded-md" aria-label={label}>
        —
      </AvatarFallback>
    </Avatar>
  );
}
export function skillResourceId(
  championId: number | null | undefined,
  slot: number | null | undefined,
) {
  return championId && slot && slot >= 1 && slot <= 4 ? championId * 10 + slot : null;
}
