/**
 * The two Babel presets used by `scripts/build.ts` ship no type declarations, and they are only ever
 * passed through to Babel, so an opaque type is the honest one
 */
declare module "babel-preset-solid" {
  const preset: unknown
  export default preset
}

declare module "@babel/preset-typescript" {
  const preset: unknown
  export default preset
}