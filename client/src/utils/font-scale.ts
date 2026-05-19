export type FontSizePreference =
  | "small"
  | "medium"
  | "large"
  | "xlarge";

export const getFontClass = (
  preference: FontSizePreference,
  options: {
    xsmall?: string;
    small: string;
    medium: string;
    large: string;
    xlarge?: string;
  },
) => {
  if (preference === "small") return options.small;
  if (preference === "xlarge") return options.xlarge ?? options.large;
  if (preference === "large") return options.large;
  return options.medium;
};

export const getFontNumber = (
  preference: FontSizePreference,
  options: {
    xsmall?: number;
    small: number;
    medium: number;
    large: number;
    xlarge?: number;
  },
) => {
  if (preference === "small") return options.small;
  if (preference === "xlarge") return options.xlarge ?? options.large;
  if (preference === "large") return options.large;
  return options.medium;
};
