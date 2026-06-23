import { PRIVACY_NOT_RECORDED, PRIVACY_RECORDED } from "../../onboardingFlow";

export function PrivacyStep() {
  return (
    <>
      <p className="onb-step-desc">Drifty records activity signals, not your screen.</p>
      <div className="onb-privacy">
        <div className="onb-privacy__group">
          <h2 className="onb-privacy__group-title">Recorded on this Mac</h2>
          <ul className="onb-privacy__list onb-privacy__list--recorded">
            {PRIVACY_RECORDED.map((item) => (
              <li className="onb-privacy__item" key={item}>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="onb-privacy__group">
          <h2 className="onb-privacy__group-title">Not intentionally recorded</h2>
          <ul className="onb-privacy__list onb-privacy__list--excluded">
            {PRIVACY_NOT_RECORDED.map((item) => (
              <li className="onb-privacy__item" key={item}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
