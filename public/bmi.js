// BMI and weight goal numbers. Pure: no Firebase, no DOM. Tests in tests/bmi.test.mjs.
// Ranges are the WHO adult cut-offs (18.5 / 25 / 30); many Asian guidelines put the top of normal at 22.9.
export const PACE = 0.5; // kg a week, for the goal date
export const WEEKLY_MINUTES = 150; // WHO weekly minimum for moderate activity

export const r1 = (n) => Math.round(n * 10) / 10;
const m2 = (p) => (p.cm / 100) ** 2;
export const bmiOf = (p, kg) => r1(kg / m2(p));
// Weights (kg) at the edges of the normal range for this person's height.
export const range = (p) => ({ lo: r1(18.5 * m2(p)), hi: r1(24.9 * m2(p)), asian: r1(22.9 * m2(p)) });
// Word and colour token for a BMI.
export const statusOf = (b) => b < 18.5 ? { t: "Underweight", c: "--under" } : b < 25 ? { t: "Normal", c: "--good" } : b < 30 ? { t: "Overweight", c: "--over" } : { t: "Obese", c: "--obese" };
