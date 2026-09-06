export type DxfCircle = {
  cx: number;
  cy: number;
  r: number;
  layer?: string;
  colorIndex?: number;
};

export type DxfPoint = {
  x: number;
  y: number;
};

export type DxfPolyline = {
  points: DxfPoint[];
  closed?: boolean;
  layer?: string;
  colorIndex?: number;
};

const formatNumber = (value: number) => value.toFixed(5);

const buildLayerTable = (layerNames: string[]) => {
  const unique = Array.from(new Set(["0", ...layerNames]));
  const lines = ["0", "TABLE", "2", "LAYER", "70", String(unique.length)];
  for (const layer of unique) {
    lines.push("0", "LAYER", "2", layer, "70", "0", "62", "7", "6", "CONTINUOUS");
  }
  lines.push("0", "ENDTAB");
  return lines;
};

export function generateDxfR12FromCircles(circles: DxfCircle[]): string {
  const layers = circles.map((c) => c.layer ??"0");
  const header = [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$INSUNITS",
    "70",
    "4",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "TABLES",
    ...buildLayerTable(layers),
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
  ];

  const entities = circles.flatMap((circle) => [
    "0",
    "CIRCLE",
    "8",
    circle.layer ??"0",
    ...(Number.isFinite(circle.colorIndex) ?["62", String(circle.colorIndex)] : []),
    "10",
    formatNumber(circle.cx),
    "20",
    formatNumber(circle.cy),
    "30",
    "0.0",
    "40",
    formatNumber(circle.r),
  ]);

  const footer = ["0", "ENDSEC", "0", "EOF"];
  return [...header, ...entities, ...footer].join("\n");
}

export function generateDxfR12FromPolylines(polylines: DxfPolyline[]): string {
  const layers = polylines.map((p) => p.layer ??"0");
  const header = [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$INSUNITS",
    "70",
    "4",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "TABLES",
    ...buildLayerTable(layers),
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
  ];

  const entities: string[] = [];
  for (const polyline of polylines) {
    if (!Array.isArray(polyline.points) || polyline.points.length < 2) continue;
    entities.push(
      "0",
      "POLYLINE",
      "8",
      polyline.layer ??"0",
      ...(Number.isFinite(polyline.colorIndex) ?["62", String(polyline.colorIndex)] : []),
      "66",
      "1",
      "70",
      polyline.closed ?"1" : "0"
    );

    for (const point of polyline.points) {
      entities.push(
        "0",
        "VERTEX",
        "8",
        polyline.layer ??"0",
        ...(Number.isFinite(polyline.colorIndex) ?["62", String(polyline.colorIndex)] : []),
        "10",
        formatNumber(point.x),
        "20",
        formatNumber(point.y),
        "30",
        "0.0"
      );
    }

    entities.push("0", "SEQEND");
  }

  const footer = ["0", "ENDSEC", "0", "EOF"];
  return [...header, ...entities, ...footer].join("\n");
}

export function generateDxfR12FromMixed(
  circles: DxfCircle[],
  polylines: DxfPolyline[]
): string {
  const layers = [
    ...circles.map((c) => c.layer ??"0"),
    ...polylines.map((p) => p.layer ??"0"),
  ];
  const header = [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$INSUNITS",
    "70",
    "4",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "TABLES",
    ...buildLayerTable(layers),
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
  ];

  const entities: string[] = [];

  for (const circle of circles) {
    entities.push(
      "0",
      "CIRCLE",
      "8",
      circle.layer ??"0",
      ...(Number.isFinite(circle.colorIndex) ?["62", String(circle.colorIndex)] : []),
      "10",
      formatNumber(circle.cx),
      "20",
      formatNumber(circle.cy),
      "30",
      "0.0",
      "40",
      formatNumber(circle.r)
    );
  }

  for (const polyline of polylines) {
    if (!Array.isArray(polyline.points) || polyline.points.length < 2) continue;
    entities.push(
      "0",
      "POLYLINE",
      "8",
      polyline.layer ??"0",
      ...(Number.isFinite(polyline.colorIndex) ?["62", String(polyline.colorIndex)] : []),
      "66",
      "1",
      "70",
      polyline.closed ?"1" : "0"
    );
    for (const point of polyline.points) {
      entities.push(
        "0",
        "VERTEX",
        "8",
        polyline.layer ??"0",
        ...(Number.isFinite(polyline.colorIndex) ?["62", String(polyline.colorIndex)] : []),
        "10",
        formatNumber(point.x),
        "20",
        formatNumber(point.y),
        "30",
        "0.0"
      );
    }
    entities.push("0", "SEQEND");
  }

  const footer = ["0", "ENDSEC", "0", "EOF"];
  return [...header, ...entities, ...footer].join("\n");
}
