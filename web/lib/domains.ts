/** The four things this app records. Each owns one pigment, used identically in
 *  the rail, the day strip, page edges and charts, so colour is an encoding
 *  rather than decoration. The pigments themselves live in globals.css and are
 *  validated as a categorical chart palette — see the note there before
 *  changing one. */
export type DomainKey = "train" | "eat" | "sleep" | "body";

export type Domain = {
  key: DomainKey;
  label: string;
  /** What a full mark on the day strip means. */
  fullMeans: string;
  color: string;
  /** The same hue stepped for the dark band, where the light-mode pigment
   *  would not carry enough contrast. */
  bandColor: string;
  wash: string;
};

export const DOMAINS: Record<DomainKey, Domain> = {
  train: {
    key: "train",
    label: "Train",
    fullMeans: "6 hard sets",
    color: "var(--c-moss)",
    bandColor: "var(--c-moss-on-band)",
    wash: "var(--c-moss-wash)",
  },
  eat: {
    key: "eat",
    label: "Eat",
    fullMeans: "155 g protein",
    color: "var(--c-marigold)",
    bandColor: "var(--c-marigold-on-band)",
    wash: "var(--c-marigold-wash)",
  },
  sleep: {
    key: "sleep",
    label: "Sleep",
    fullMeans: "8 hours",
    color: "var(--c-indigo)",
    bandColor: "var(--c-indigo-on-band)",
    wash: "var(--c-indigo-wash)",
  },
  body: {
    key: "body",
    label: "Move",
    fullMeans: "10,000 steps",
    color: "var(--c-rust)",
    bandColor: "var(--c-rust-on-band)",
    wash: "var(--c-rust-wash)",
  },
};

export const DOMAIN_ORDER: DomainKey[] = ["train", "eat", "sleep", "body"];
