export type SummitZone = "nw" | "ne" | "sw" | "se";

export type ServerTile = {
  row: number;
  col: number;
  level: number;
  zone?: SummitZone;
};

export function getRingLevel(row: number, col: number): number {
  const min = Math.min(row, col, 8 - row, 8 - col);

  if (min === 0) return 1;
  if (min === 1) return 2;
  if (min === 2) return 3;
  if (min === 3) return 4;
  if (min === 4) return 5;

  return -1;
}

export function createHillTiles(): ServerTile[] {
  const tiles: ServerTile[] = [];

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const level = getRingLevel(row, col);

      if (level === 5) {
        tiles.push({ row, col, level, zone: "nw" });
        tiles.push({ row, col, level, zone: "ne" });
        tiles.push({ row, col, level, zone: "sw" });
        tiles.push({ row, col, level, zone: "se" });
      } else {
        tiles.push({ row, col, level });
      }
    }
  }

  return tiles;
}

export function getTilesByLevel(level: number): ServerTile[] {
  return createHillTiles().filter((tile) => tile.level === level);
}
