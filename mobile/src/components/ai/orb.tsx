import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, ClipPath, Defs, Ellipse, FeGaussianBlur, Filter, G, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useReducedMotion } from '@/src/components/motion';

// The assistant's face: the web's SiriOrb colours and motion, lit as a raised
// dome — an egg yolk, which is what the owner asked for and what the shape was
// always trying to be.
//
// The swirl underneath is unchanged: three layers of soft colour blobs spinning
// at 1x, 2x (reversed) and 3x over a saturated base, blurred just enough to melt
// into each other, with a bright core drifting slowly across them.
//
// What changed is everything above the swirl. The previous version ringed the
// circle in white and ran a bright streak around that rim, which is how a lens
// is lit — and a lens reads flat, because a bright silhouette says "this edge is
// facing me" everywhere at once. A dome is lit the opposite way: bright where
// the light lands, darkening steadily toward the far side, darkest right at the
// silhouette where the surface has turned away. The highlight sits still while
// the colour moves under it, because a specular is a reflection of the room, and
// a reflection that chases the swirl reads as a flat sticker turning.
//
// The light is fixed at the upper left. Every gradient below is written against
// that one decision, so moving LIGHT means moving all of them together.
const BASE = '#FF8F52'; // oklch(78% 0.17 45) — orange
const AMBER = '#FABB41'; // oklch(83% 0.15 80)
const CORAL = '#FF6F69'; // oklch(72% 0.18 25)

// Where the light comes from, in the 0-100 space every layer is drawn in.
const LIGHT = { x: 36, y: 30 };
// Its opposite, where the surface turns away and the shadow gathers.
const DARK = '#7A2408';

// The aura, as a ramp across the gap between the ball's edge and the far side
// of its box. Each row is (how far across that gap, colour, opacity), so the
// shape holds together whatever AURA_REACH is set to — the alternative, offsets
// written against the ball's edge by hand, silently runs off the end of the
// gradient the moment the reach is pulled in.
//
// It is short and faint on purpose: the light should only just get past the
// outline. Anything more and the ball stops looking like it is glowing and
// starts looking like it is sitting in fog.
const AURA = [
  { at: -0.06, colour: '#FFF8E8', opacity: 0.26 },
  { at: 0.04, colour: '#FFF1D2', opacity: 0.2 },
  { at: 0.12, colour: '#FCE7B4', opacity: 0.132 },
  { at: 0.22, colour: '#F9DC9C', opacity: 0.086 },
  { at: 0.34, colour: '#F6D188', opacity: 0.053 },
  { at: 0.47, colour: '#F3C877', opacity: 0.031 },
  { at: 0.61, colour: '#F1C16A', opacity: 0.017 },
  { at: 0.76, colour: '#EFBB60', opacity: 0.008 },
  { at: 0.9, colour: '#EEB85B', opacity: 0.0025 },
  { at: 1, colour: '#EEB85B', opacity: 0 },
];

// How far past the ball the light is allowed to reach, as a share of its size.
const AURA_REACH = 0.3;

// Where the glints sit on the aura, and how long each one is drawn out. Three,
// at angles that are not evenly spaced, so the turn never lands back on a
// pattern the eye has already learned.
const GLINTS = [
  { angle: 214, rx: 15, ry: 7, opacity: 0.9 },
  { angle: 342, rx: 11, ry: 5.5, opacity: 0.62 },
  { angle: 96, rx: 8, ry: 4.5, opacity: 0.44 },
];

// Positions are in the layer's own 100x100 space, so one set of numbers works
// at every orb size.
type Blob = { x: number; y: number; r: number; colour: string };

const LAYERS: { blobs: Blob[]; speed: number; reverse: boolean; opacity: number }[] = [
  {
    speed: 1,
    reverse: false,
    opacity: 1,
    blobs: [
      { x: 30, y: 32, r: 55, colour: BASE },
      { x: 74, y: 66, r: 50, colour: CORAL },
      { x: 68, y: 24, r: 42, colour: AMBER },
    ],
  },
  {
    speed: 2,
    reverse: true,
    opacity: 0.75,
    blobs: [
      { x: 30, y: 74, r: 48, colour: AMBER },
      { x: 22, y: 28, r: 40, colour: CORAL },
      { x: 76, y: 50, r: 44, colour: BASE },
    ],
  },
  {
    speed: 3,
    reverse: false,
    opacity: 0.5,
    blobs: [
      { x: 50, y: 20, r: 36, colour: CORAL },
      { x: 50, y: 82, r: 36, colour: AMBER },
    ],
  },
];

// The ball's outline, as an SVG clip rather than a rounded view.
//
// `overflow: hidden` with a border radius was the obvious way to do this, and it
// worked right up until the orb could be squashed. Android clips a rounded view
// through its outline, and the outline does not follow a non-uniform scale on an
// ancestor: press the orb and the drawing was let out past its own silhouette as
// a straight-edged wedge below the ball. Splitting the clip onto its own view
// did not help — the outline is still the ancestor's problem.
//
// Clipping inside the SVG instead puts the outline in the same coordinate space
// as the drawing, so any transform above carries both together. Every layer
// declares its own copy: defs are per-<Svg>, and an id from one does not reach
// into another.
function BallClip({ uid }: { uid: string }) {
  return (
    <ClipPath id={`ball${uid}`}>
      <Circle cx={50} cy={50} r={50} />
    </ClipPath>
  );
}

function BlobLayer({ blobs, blur, uid }: { blobs: Blob[]; blur: number; uid: string }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      <Defs>
        <BallClip uid={uid} />
        <Filter id={`f${uid}`} x="-30%" y="-30%" width="160%" height="160%">
          <FeGaussianBlur stdDeviation={blur} />
        </Filter>
        {blobs.map((blob, index) => (
          <RadialGradient key={index} id={`g${uid}${index}`} cx={blob.x} cy={blob.y} r={blob.r} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={blob.colour} stopOpacity={1} />
            <Stop offset="0.62" stopColor={blob.colour} stopOpacity={0.92} />
            <Stop offset="1" stopColor={blob.colour} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      {/* Drawn wider than the circle so the blur's own soft edge falls outside
          it, then cut back to the outline — which is why the blur has to be
          applied inside the clip and not the other way round. */}
      <G clipPath={`url(#ball${uid})`}>
        <G filter={`url(#f${uid})`}>
          {blobs.map((_, index) => (
            <Rect key={index} x={-25} y={-25} width={150} height={150} fill={`url(#g${uid}${index})`} />
          ))}
        </G>
      </G>
    </Svg>
  );
}

export function AIOrb({
  size,
  speed = 20,
  interactive = false,
  style,
}: {
  size: number;
  /** Seconds for the slowest layer to turn once; the web uses 20, or 8 in the floating chat. */
  speed?: number;
  /**
   * Press it and it gives, let go and it springs back past its own shape once or
   * twice before settling. Off by default: the 30px orb beside a chat bubble is
   * decoration inside a scrolling list, and a press target there would only get
   * in the way of the scroll.
   */
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reducedMotion = useReducedMotion();
  const spin = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const sheen = useRef(new Animated.Value(0)).current;
  // The give in the surface, and the breath in the glow around it.
  const wobbleA = useRef(new Animated.Value(0)).current;
  const wobbleB = useRef(new Animated.Value(0)).current;
  const tilt = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  // 0 at rest, 1 held down. Not a clock — this one is driven by a finger.
  const poke = useRef(new Animated.Value(0)).current;
  const uid = useRef(Math.random().toString(36).slice(2, 8)).current;

  useEffect(() => {
    const slow = reducedMotion ? 1.6 : 1;
    const turn = (value: Animated.Value, seconds: number) =>
      Animated.loop(
        Animated.timing(value, {
          toValue: 1,
          duration: seconds * slow * 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
    // Every clock runs a whole turn, so no cycle ever ends on a jump. The wobble
    // clocks are deliberately not multiples of each other: on one clock the
    // wobble repeats visibly, and periods that never line up read as something
    // soft rather than something mechanical.
    const loops = [
      turn(spin, speed),
      turn(drift, speed * 2.6),
      turn(sheen, speed * 1.4),
      turn(wobbleA, speed * 0.17),
      turn(wobbleB, speed * 0.27),
      turn(tilt, speed * 0.41),
      turn(pulse, speed * 0.23),
      turn(shimmer, speed * 1.9),
    ];
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [drift, pulse, reducedMotion, sheen, shimmer, speed, spin, tilt, wobbleA, wobbleB]);

  const blur = size < 50 ? 1 : 2;
  const coreDrift = drift.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const sheenTurn = sheen.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // An avatar-sized orb is 30px across: a highlight drawn for 128px turns into a
  // white blot at that scale, so the gloss is dialled back rather than dropped.
  const small = size < 50;
  const specular = small ? 0.42 : 0.7;

  // The give in the edge.
  //
  // The first attempt held a fixed squash and turned its axis, so the bulge
  // travelled around the rim — which turned out to read as an egg being rolled,
  // not as something soft. What a soft body actually does is deform and spring
  // back along an axis that stays put. So: fixed axes, and it is the *amount*
  // that oscillates, on two axes at rates that never line up.
  //
  // Each squash preserves area — one direction gives exactly as much as the
  // other takes — which is what keeps it looking like something being pressed
  // rather than something being resized.
  const give = small ? 0.012 : 0.032;

  // A sine sampled at eight points, so a linear clock comes out as a smooth
  // swell instead of the sharp reversal a two-point ramp gives at each end.
  const SINE = [0, 0.707, 1, 0.707, 0, -0.707, -1, -0.707, 0];
  const wave = (clock: Animated.Value, amplitude: number) =>
    clock.interpolate({
      inputRange: SINE.map((_, index) => index / (SINE.length - 1)),
      outputRange: SINE.map((point) => 1 + point * amplitude),
    });
  const squashAX = wave(wobbleA, give);
  const squashAY = wave(wobbleA, -give);
  const squashBX = wave(wobbleB, give * 0.62);
  const squashBY = wave(wobbleB, -give * 0.62);
  // A slow lean, a degree or so either way. Small enough not to read as
  // spinning, big enough that the wobble is never perfectly symmetrical.
  const lean = tilt.interpolate({
    inputRange: SINE.map((_, index) => index / (SINE.length - 1)),
    outputRange: SINE.map((point) => `${(point * (small ? 0.6 : 1.6)).toFixed(3)}deg`),
  });
  // One linear clock read as a triangle, so the breath rises and falls on a
  // single loop that can never end mid-way through a fade.
  const triangle = (clock: Animated.Value, low: number, high: number) =>
    clock.interpolate({ inputRange: [0, 0.5, 1], outputRange: [low, high, low] });
  const breathe = triangle(pulse, 1, 1.014);
  const glowBreath = triangle(pulse, 0.72, 1);
  const glowScale = triangle(pulse, 0.97, 1.05);
  const shimmerTurn = shimmer.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  // Pressing is stiff and well damped, so the give lands under the finger with
  // no argument. Letting go is the opposite: a loose spring that overshoots and
  // comes back a couple of times, which is the whole bounce — a return that
  // settles straight onto its mark feels like a button, not like jelly.
  const press = (down: boolean) => {
    // No stopAnimation() first, however tempting. A value driven natively has to
    // make a round trip to the native side to be stopped, and on iOS the
    // callback that was starting the spring never came back — the orb simply
    // stopped responding to touch. Starting an animation on a value already
    // stops whatever was running on it, so the guard bought nothing and cost
    // the whole interaction.
    Animated.spring(poke, {
      toValue: down ? 1 : 0,
      useNativeDriver: true,
      // Down is stiff and well damped, so the give lands under the finger with
      // no argument. Up is loose, so it overshoots and comes back a couple of
      // times — a release that settles straight onto its mark feels like a
      // button, not like jelly. Not looser than this, though: a bounce still
      // ringing when the next tap arrives is what makes rapid taps look broken.
      ...(down ? { damping: 15, stiffness: 340, mass: 0.7 } : { damping: 7.5, stiffness: 230, mass: 0.85 }),
    }).start();
    // A tap on something soft should be felt, not just seen. Fire and forget:
    // the phone may have haptics switched off, or be a device without them, and
    // neither is worth an error on a decorative touch.
    if (down) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  };
  // Squashed wider than it is tall, and pushed very slightly into the page.
  const pokeX = poke.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const pokeY = poke.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] });
  const pokeSink = poke.interpolate({ inputRange: [0, 1], outputRange: [1, 0.965] });
  // It brightens as it is squeezed, the way something lit from inside does when
  // there is less of it for the light to travel through.
  const pokeGlow = poke.interpolate({ inputRange: [0, 1], outputRange: [0, 0.42] });
  const pokeGlowSpread = poke.interpolate({ inputRange: [0, 1], outputRange: [0, 0.1] });

  // How far past the ball the light reaches. It is drawn outside the clipped
  // circle, because anything inside it is cut off at the very edge the glow is
  // supposed to spill over.
  const halo = Math.round(size * (small ? 0.22 : AURA_REACH));
  // Where the ball's edge falls inside that box, as a fraction of its radius.
  // Every stop in the aura is placed against this, so the bright band lands on
  // the outline itself however far the light is set to reach.
  const ball = size / (size + halo * 2);

  return (
    // Two views, not one: the caller's drop shadow lives on the outer one,
    // because `overflow: hidden` on the same view clips the shadow away on iOS
    // and the orb loses the very thing that makes it sit above the page.
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          ...Platform.select({ android: { elevation: small ? 0 : 6 }, default: {} }),
        },
        style,
      ]}
    >
      {/* The glow, drawn outside the ball. It has to live out here: the circle
          below clips at its own edge, which is the exact edge the light is meant
          to spill past. The layout box stays `size`, so nothing around the orb
          moves to make room for it. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: -halo,
          top: -halo,
          width: size + halo * 2,
          height: size + halo * 2,
          opacity: Animated.add(glowBreath, pokeGlow),
          transform: [{ scale: Animated.add(glowScale, pokeGlowSpread) }],
        }}
      >
        <Svg width="100%" height="100%" viewBox="0 0 100 100">
          <Defs>
            {/* The ball fills the middle half of this box, so its edge is at
                offset 0.5 — that is where the light has to be brightest for the
                rim to look like it is the thing glowing. Inside 0.5 is under the
                ball and invisible; everything past it is spill.

                The stops are close together and never jump far, because a
                radial gradient crossing a wide gap in few steps banded into
                visible rings on Android — the same failure the orb's contrast
                pass hit before. */}
            <RadialGradient id={`halo${uid}`} cx={50} cy={50} r={50} gradientUnits="userSpaceOnUse">
              <Stop offset="0.46" stopColor={AMBER} stopOpacity={0.5} />
              <Stop offset="0.52" stopColor={AMBER} stopOpacity={0.44} />
              <Stop offset="0.58" stopColor="#FFA24D" stopOpacity={0.33} />
              <Stop offset="0.64" stopColor={BASE} stopOpacity={0.24} />
              <Stop offset="0.70" stopColor={BASE} stopOpacity={0.17} />
              <Stop offset="0.76" stopColor="#FF8258" stopOpacity={0.11} />
              <Stop offset="0.82" stopColor={CORAL} stopOpacity={0.065} />
              <Stop offset="0.88" stopColor={CORAL} stopOpacity={0.032} />
              <Stop offset="0.94" stopColor={CORAL} stopOpacity={0.012} />
              <Stop offset="1" stopColor={CORAL} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={100} height={100} fill={`url(#halo${uid})`} />
        </Svg>
      </Animated.View>

      <Animated.View
        style={{
          width: size,
          height: size,
          // A squash straight up-and-down, a second one on the diagonal, a slow
          // lean, and a breath. Two fixed axes rather than a turning one: the
          // diagonal pair is rotated in and straight back out, so the contents
          // finish facing the way they started and only the outline moves.
          transform: [
            { scaleX: squashAX },
            { scaleY: squashAY },
            { rotate: '45deg' },
            { scaleX: squashBX },
            { scaleY: squashBY },
            { rotate: '-45deg' },
            { rotate: lean },
            { scale: breathe },
            // Last, so the press reads on top of whatever the idle wobble is
            // doing rather than fighting it for the same axis.
            { scaleX: pokeX },
            { scaleY: pokeY },
            { scale: pokeSink },
          ],
        }}
      >
        {/* The aura rides inside the squash, so light and shape deform together.
            Outside it, the ball would flatten while its halo stayed a circle.

            The shape of it is the whole point. A wide even wash reads as haze —
            the light equivalent of a smudged lens — so the brightness is packed
            into a narrow band sitting right on the outline and then falls away
            fast, with a long faint tail carrying the last of it out. That is
            what makes an edge look like it is radiating rather than merely
            surrounded by something bright. */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: -halo,
            top: -halo,
            width: size + halo * 2,
            height: size + halo * 2,
            opacity: Animated.add(glowBreath, pokeGlow),
            transform: [{ scale: Animated.add(glowScale, pokeGlowSpread) }],
          }}
        >
          <Svg width="100%" height="100%" viewBox="0 0 100 100">
            <Defs>
              {/* Gold, not fire. An orange-into-coral ramp made the halo read as
                  heat coming off the ball; a pale gold falling to a deeper one
                  reads as light.

                  Stops are close together and never jump far: a radial gradient
                  crossing a wide gap in few steps banded into visible rings —
                  the same failure the orb's contrast pass hit. */}
              <RadialGradient id={`aura${uid}`} cx={50} cy={50} r={50} gradientUnits="userSpaceOnUse">
                {AURA.map((stop) => (
                  <Stop
                    key={stop.at}
                    offset={Math.max(0, Math.min(1, ball + (1 - ball) * stop.at))}
                    stopColor={stop.colour}
                    stopOpacity={stop.opacity}
                  />
                ))}
              </RadialGradient>
            </Defs>
            <Rect x={0} y={0} width={100} height={100} fill={`url(#aura${uid})`} />
          </Svg>
        </Animated.View>

        {/* The glint. Three soft lobes of warmer light sitting on the aura and
            turning slowly, so the halo is never quite even and never quite the
            same twice. Without it the glow is a perfect ring, and a perfect ring
            reads as a printed shape rather than as something giving off light.
            Kept faint on purpose: this should be noticed as a quality of the
            light, not as three blobs going round. */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: -halo,
            top: -halo,
            width: size + halo * 2,
            height: size + halo * 2,
            opacity: glowBreath,
            transform: [{ rotate: shimmerTurn }],
          }}
        >
          <Svg width="100%" height="100%" viewBox="0 0 100 100">
            <Defs>
              <RadialGradient id={`glint${uid}`} cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#FFF7E4" stopOpacity={0.2} />
                <Stop offset="0.5" stopColor="#F8DCA0" stopOpacity={0.08} />
                <Stop offset="1" stopColor="#F8DCA0" stopOpacity={0} />
              </RadialGradient>
              <Filter id={`glintblur${uid}`} x="-60%" y="-60%" width="220%" height="220%">
                <FeGaussianBlur stdDeviation={small ? 2 : 4.5} />
              </Filter>
            </Defs>
            <G filter={`url(#glintblur${uid})`}>
              {GLINTS.map((glint, index) => {
                const radius = 50 * (ball + (1 - ball) * 0.12);
                const radians = (glint.angle * Math.PI) / 180;
                return (
                  <Ellipse
                    key={index}
                    cx={50 + radius * Math.cos(radians)}
                    cy={50 + radius * Math.sin(radians)}
                    rx={glint.rx}
                    ry={glint.ry}
                    fill={`url(#glint${uid})`}
                    opacity={glint.opacity}
                    transform={`rotate(${glint.angle + 90} ${50 + radius * Math.cos(radians)} ${50 + radius * Math.sin(radians)})`}
                  />
                );
              })}
            </G>
          </Svg>
        </Animated.View>

        {/* The clip is its own view. Rounding and `overflow: hidden` on the same
            view that carries a non-uniform scale left the clip at its unsquashed
            size on Android: press the ball and a straight-edged wedge appeared
            below it, where the drawing had been let out past its own outline. */}
        {/* No borderRadius and no overflow here any more — see BallClip. The
            ball's own colour moved into the first layer for the same reason: a
            view background is a rounded rect, and a rounded rect is exactly what
            Android was failing to clip. */}
        <View style={{ width: size, height: size }}>
          <Svg width="100%" height="100%" viewBox="0 0 100 100" style={{ position: 'absolute', top: 0, left: 0 }}>
            <Circle cx={50} cy={50} r={50} fill={BASE} />
          </Svg>
        {LAYERS.map((layer, index) => {
          const turns = 360 * layer.speed;
          const rotate = spin.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', `${layer.reverse ? -turns : turns}deg`],
          });
          return (
            <Animated.View
              key={index}
              style={{ position: 'absolute', top: 0, left: 0, width: size, height: size, opacity: layer.opacity, transform: [{ rotate }] }}
            >
              <BlobLayer blobs={layer.blobs} blur={blur} uid={`${uid}${index}`} />
            </Animated.View>
          );
        })}

        {/* The yolk's warm centre, drifting slowly under the glaze. Pulled toward
            the light so the body of the dome is brightest where it should be. */}
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, width: size, height: size, transform: [{ rotate: coreDrift }] }}>
          <Svg width="100%" height="100%" viewBox="0 0 100 100">
            <Defs>
              <BallClip uid={`core${uid}`} />
            <RadialGradient id={`core${uid}`} cx={42} cy={38} r={54} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor="#FFE712" stopOpacity={0.95} />
                <Stop offset="0.5" stopColor="#FFD31A" stopOpacity={0.86} />
                <Stop offset="0.82" stopColor="#FFAE3C" stopOpacity={0.3} />
                <Stop offset="1" stopColor="#FFAE3C" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <G clipPath={`url(#ballcore${uid})`}>
              <Rect x={-25} y={-25} width={150} height={150} fill={`url(#core${uid})`} />
            </G>
          </Svg>
        </Animated.View>

        {/* A slow sheen travelling under the glaze. It stays well inside the
            silhouette — out at the rim it would draw the bright ring that made
            the old orb read as a disc. */}
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, width: size, height: size, transform: [{ rotate: sheenTurn }] }}
        >
          <Svg width="100%" height="100%" viewBox="0 0 100 100">
            <Defs>
              <BallClip uid={`sheen${uid}`} />
              <LinearGradient id={`sheen${uid}`} x1={22} y1={22} x2={66} y2={62} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor="#FFF7D6" stopOpacity={0} />
                <Stop offset="0.5" stopColor="#FFF7D6" stopOpacity={0.3} />
                <Stop offset="1" stopColor="#FFF7D6" stopOpacity={0} />
              </LinearGradient>
              <Filter id={`sheenblur${uid}`} x="-30%" y="-30%" width="160%" height="160%">
                <FeGaussianBlur stdDeviation={4} />
              </Filter>
            </Defs>
            <G clipPath={`url(#ballsheen${uid})`}>
              <Ellipse cx={42} cy={40} rx={30} ry={20} fill={`url(#sheen${uid})`} filter={`url(#sheenblur${uid})`} />
            </G>
          </Svg>
        </Animated.View>

        {/* The dome itself. Nothing below this point moves: a lit surface holds
            still while what is under it turns. */}
        <Svg width="100%" height="100%" viewBox="0 0 100 100" style={{ position: 'absolute', top: 0, left: 0 }}>
          <Defs>
            {/* Shading away from the light. This is the whole illusion: one long
                ramp from clear at the lit side to deep at the far rim. */}
            <BallClip uid={`dome${uid}`} />
            <RadialGradient id={`dome${uid}`} cx={LIGHT.x} cy={LIGHT.y} r={82} gradientUnits="userSpaceOnUse">
              <Stop offset="0.28" stopColor={DARK} stopOpacity={0} />
              <Stop offset="0.62" stopColor={DARK} stopOpacity={0.14} />
              <Stop offset="0.85" stopColor={DARK} stopOpacity={0.34} />
              <Stop offset="1" stopColor="#5E1904" stopOpacity={0.5} />
            </RadialGradient>
            {/* The silhouette, where the surface has turned fully away. Even on
                the lit side a dome darkens a little right at the edge. */}
            <RadialGradient id={`turn${uid}`} cx={50} cy={50} r={50} gradientUnits="userSpaceOnUse">
              <Stop offset="0.82" stopColor={DARK} stopOpacity={0} />
              <Stop offset="0.95" stopColor={DARK} stopOpacity={0.18} />
              <Stop offset="1" stopColor={DARK} stopOpacity={0.42} />
            </RadialGradient>
            {/* The rim itself, lit from within.
                Centred near the light rather than in the middle, so the far side
                of the ball is further from that centre and reaches the bright
                end of the ramp while the lit side never gets there. One gradient
                does the whole job — no mask, no second pass.

                Uneven on purpose. A rim that is bright the whole way round is
                exactly the flat lens this drawing started out as; a rim that is
                brightest where the surface has turned away is both what a
                glowing body does (the thin edge is where light escapes) and what
                leaves the dome intact. */}
            <RadialGradient id={`rimlight${uid}`} cx={LIGHT.x + 4} cy={LIGHT.y + 6} r={72} gradientUnits="userSpaceOnUse">
              <Stop offset="0.62" stopColor="#FFC46B" stopOpacity={0} />
              <Stop offset="0.74" stopColor="#FFC46B" stopOpacity={0.06} />
              <Stop offset="0.83" stopColor="#FFCE79" stopOpacity={0.17} />
              <Stop offset="0.90" stopColor="#FFD98E" stopOpacity={0.34} />
              <Stop offset="0.96" stopColor="#FFE4A6" stopOpacity={0.54} />
              <Stop offset="1" stopColor="#FFEDC0" stopOpacity={0.72} />
            </RadialGradient>
            {/* Light bouncing back up off the page onto the underside. Small, but
                without it the bottom looks stuck to the background rather than
                lifted off it. */}
            <RadialGradient id={`bounce${uid}`} cx={56} cy={97} r={36} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#FFD79B" stopOpacity={0.38} />
              <Stop offset="1" stopColor="#FFD79B" stopOpacity={0} />
            </RadialGradient>
            {/* The reflection of the room: a broad soft pool with a brighter
                heart, both offset toward the light and squashed the way a
                reflection is on a curved surface. */}
            {/* Object-bounding-box units, so this one gradient fills whichever
                ellipse references it rather than a fixed spot on the orb. */}
            <RadialGradient id={`gloss${uid}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFFDF2" stopOpacity={0.85} />
              <Stop offset="0.45" stopColor="#FFF6CE" stopOpacity={0.34} />
              <Stop offset="1" stopColor="#FFF6CE" stopOpacity={0} />
            </RadialGradient>
            <Filter id={`glossblur${uid}`} x="-40%" y="-40%" width="180%" height="180%">
              <FeGaussianBlur stdDeviation={small ? 1.6 : 3.4} />
            </Filter>
            <Filter id={`hotblur${uid}`} x="-60%" y="-60%" width="220%" height="220%">
              <FeGaussianBlur stdDeviation={small ? 1 : 1.9} />
            </Filter>
          </Defs>

          <G clipPath={`url(#balldome${uid})`}>
          <Rect x={0} y={0} width={100} height={100} fill={`url(#dome${uid})`} />
          <Rect x={0} y={0} width={100} height={100} fill={`url(#turn${uid})`} />
          <Rect x={0} y={0} width={100} height={100} fill={`url(#bounce${uid})`} />
          <Rect x={0} y={0} width={100} height={100} fill={`url(#rimlight${uid})`} />

          <Ellipse
            cx={LIGHT.x}
            cy={LIGHT.y - 2}
            rx={26}
            ry={17}
            fill={`url(#gloss${uid})`}
            opacity={specular}
            filter={`url(#glossblur${uid})`}
            transform={`rotate(-24 ${LIGHT.x} ${LIGHT.y - 2})`}
          />
          <Ellipse
            cx={LIGHT.x - 4}
            cy={LIGHT.y - 6}
            rx={11}
            ry={6.5}
            fill="#FFFFFF"
            opacity={specular * 0.62}
            filter={`url(#hotblur${uid})`}
            transform={`rotate(-24 ${LIGHT.x - 4} ${LIGHT.y - 6})`}
          />
          </G>
          </Svg>
        </View>
      </Animated.View>

      {/* The press target, laid over the ball rather than wrapped around it, so
          the squash below is free to change shape without moving what the finger
          is aiming at. Deliberately left out of the accessibility tree with
          everything else here: pressing it is a small pleasure, not a control,
          and announcing a button that does nothing would be a worse experience
          than announcing nothing at all. */}
      {interactive ? (
        <Pressable
          onPressIn={() => press(true)}
          onPressOut={() => press(false)}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, borderRadius: size / 2 }}
        />
      ) : null}
    </View>
  );
}
