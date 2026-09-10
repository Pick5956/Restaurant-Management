import { isLiquidGlassAvailable } from 'expo-glass-effect';

/**
 * Whether this device has Apple's real Liquid Glass material.
 *
 * Read once at module load: the answer is a property of the OS and cannot change
 * while the app is running, which is also why it is a constant rather than a
 * hook. False on every Android device and every iPhone below iOS 26.
 *
 * It lives here rather than in `components/ai/chrome`, which owns the assistant
 * screen's gradients, modal and pan responder — importing that module for one
 * boolean pulls all of it into whatever screen asks.
 *
 * Anything that renders a `GlassView` behind this flag MUST also render a
 * non-glass fallback. The glass view is a background, not a decoration: ship it
 * alone and every device without the material gets a control with nothing
 * behind it.
 */
export const LIQUID_GLASS = isLiquidGlassAvailable();
