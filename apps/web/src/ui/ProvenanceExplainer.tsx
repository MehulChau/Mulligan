/**
 * The one explanation of what "measured" vs "estimated" means -- shared
 * between onboarding's third screen and the settings sheet's permanent
 * entry point (Part C asks for both to exist, not two different
 * explanations of the same idea). This is the product's defining honesty
 * and used to only appear as dashed tile borders plus a one-line legend;
 * this is the fuller version for anyone who wants to know why.
 */
export function ProvenanceExplainer() {
  return (
    <div className="provenance-explainer">
      <div className="provenance-explainer-row">
        <span className="legend-swatch measured provenance-explainer-swatch" />
        <div>
          <div className="provenance-explainer-title">Measured</div>
          <div className="provenance-explainer-body">
            Came directly off your swing -- the device's camera actually saw it. Right now that's ball speed and launch angle; a single-camera rig can't see spin yet.
          </div>
        </div>
      </div>
      <div className="provenance-explainer-row">
        <span className="legend-swatch estimated provenance-explainer-swatch" />
        <div>
          <div className="provenance-explainer-title">Estimated</div>
          <div className="provenance-explainer-body">
            Filled in from a model, not your swing -- built from real Trackman tour-average data, but not something the device measured this time. Spin, spin axis, and start line are estimated today.
          </div>
        </div>
      </div>
      <div className="provenance-explainer-note">
        Simulated and Manual mode show the same distinction, for the fields a real device would and wouldn't be able to measure -- so the honesty holds even before you're hitting real shots.
      </div>
    </div>
  );
}
