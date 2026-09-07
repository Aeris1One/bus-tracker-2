export const PUBLISH_CHUNK_SIZE = 500;

// La clé Redis d'un tracé expire après SHAPE_KEY_REGISTRY_TTL_MS ; elle est réécrite après
// SHAPE_KEY_REWRITE_MS pour épargner Redis.
export const SHAPE_KEY_REWRITE_MS = 600_000;
export const SHAPE_KEY_REGISTRY_TTL_MS = 900_000;
export const SHAPE_KEY_PREFIX = "NR:RoutePath";
export const SHAPE_KEY_LOCAL_VERSION = "local";
export const STOP_REF_PREFIX = "NR:StopPoint";

export const DARWIN_TIME_ZONE = "Europe/London";
// https://wiki.openraildata.com/index.php/Darwin:Schedule_Element#Ordering
export const TIME_BACKWARD_TOLERANCE_MS = 6 * 3_600_000;
export const TIME_FORWARD_TOLERANCE_MS = 18 * 3_600_000;
export const TIME_MAX_SHIFTS = 5;

export const PENDING_STATUS_TTL_MS = 600_000;
export const PENDING_STATUS_MAX = 5_000;

// Génération de tracés, voir route-shape.ts.
export const NODE_GRID_CELL_DEGREES = 0.02;
export const CANDIDATE_RADIUS_METERS = 200;
export const CANDIDATE_CLUSTER_METERS = 80;
export const CANDIDATE_MAX = 12;
export const TURN_PENALTY_METERS = 5_000;
export const TURN_ANGLE_DEGREES = 120;
export const ROUTE_MEMO_MAX = 250_000;
export const ROUTE_MEMO_EVICT_RATIO = 0.2;
export const SHAPE_COORDINATE_DIGITS = 6;
export const SHAPE_DISTANCE_DIGITS = 1;

export const TIMETABLE_CHECK_INTERVAL_MS = 600_000;
export const SWEEP_INTERVAL_MS = 300_000;
export const TRAIN_RETENTION_MS = 1_800_000;
export const PUBLISH_WATCHDOG_MS = 30_000;
export const CYCLE_MIN_WAIT_MS = 10_000;
export const CYCLE_MAX_WAIT_MS = 120_000;
export const PRECOMPUTE_BATCH_SIZE = 25;

// Les numéros de séquence PushPort retourne à zéro après 9_999_999
export const SEQUENCE_MAX = 9_999_999;
export const SEQUENCE_WARN_INTERVAL_MS = 30_000;

// Avertir si :
// - Plus de 2% des tracés sont des ponts
export const QUALITY_BRIDGE_RATIO = 0.02;
// - Les ponts ont une moyenne de plus de 800m
export const QUALITY_BRIDGE_MEAN_METERS = 800;
// - Plus de 2% des tracés sont plus court que le vol d'oiseau ou plus de 1.6x plus long que le vol d'oiseau
export const QUALITY_OUT_OF_BAND_RATIO = 0.02;
