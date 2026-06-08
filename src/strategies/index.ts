/**
 * F4 — Strategy index. Re-exports registry API and triggers auto-registration
 * of all bundled strategies via side-effect imports at the bottom.
 *
 * Strategy modules MUST import `registerStrategy` from `./registry` (NOT from
 * `./index`) to avoid an ES module circular-import order problem where
 * `registerStrategy` would be undefined at strategy module evaluation time.
 *
 * Tier A / B strategies live under this folder. Tier C is reserved for W6
 * LLM-driven additions and is intentionally NOT importable here yet.
 */

export {
  _resetRegistryForTests,
  STRATEGIES,
  getStrategyById,
  listStrategiesByCountry,
  listStrategiesByTier,
  registerStrategy,
} from './registry';

// ───────────────────────────────────────────────────────────────────────────
// Auto-registration of bundled strategies (side-effect imports).
// Each module calls registerStrategy() at top level.
// ───────────────────────────────────────────────────────────────────────────

// A-tier (deterministic / semi-deterministic high-confidence) strategies.
import './es.beckham';
import './pt.ifici';
import './uk.fig';
import './nl.30percent';
import './de.expatriate';
import './eu.splittingverfahren';
import './es.deduccion_arrendamiento';
import './pt.jovem';
