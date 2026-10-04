import deviceIcon from "../../assets/device-platform/device-laptop.svg?raw";

// Unmodified Tabler outline asset. Source: https://github.com/tabler/tabler-icons
// Source revision: 74929e50416e2b7c0abb8368cdc74bdcb2560ab6.
// MIT notice: public/third-party/Tabler-Icons-LICENSE.txt.
export function DeviceSourceIcon({ label }: { readonly label: string }) {
  return (
    <span
      className="week-activity-inspector__device-icon"
      role="img"
      aria-label={label}
      // Only the checked-in, trusted SVG asset enters this element.
      dangerouslySetInnerHTML={{ __html: deviceIcon }}
    />
  );
}
