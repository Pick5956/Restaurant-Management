import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Pressable, View } from 'react-native';

import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { useReducedMotion } from '@/src/components/motion';
import { Bone, SkeletonReveal } from '@/src/components/skeleton';
import type { AIGuidedAction } from '@/src/lib/ai-actions';
import { parseAIResponseBlocks } from '@/src/lib/ai-response';

import { AIOrb } from './orb';
import { AI_ORB_AVATAR, ai } from './theme';

// The two bubbles and what hangs under an answer, matching the web's classes:
// user = orange gradient, sharp bottom-right corner; assistant = white with a
// hairline, sharp top-left corner, the orb as avatar.

export function AIResponseContent({ content, color = ai.text }: { content: string; color?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {parseAIResponseBlocks(content).map((block, blockIndex) => (
        <View
          key={`${block.kind}-${blockIndex}`}
          style={{ flexDirection: block.kind === 'bullet' ? 'row' : 'column', alignItems: 'flex-start', gap: block.kind === 'bullet' ? 6 : 0 }}
        >
          {block.marker ? (
            <Text style={{ minWidth: 14, fontSize: 13, lineHeight: 20, color: ai.faint }}>{block.marker}</Text>
          ) : null}
          <Text
            selectable
            style={{
              flexShrink: 1,
              fontSize: block.kind === 'heading' ? 14 : 13,
              lineHeight: block.kind === 'heading' ? 20 : 20,
              fontWeight: block.kind === 'heading' ? '600' : '400',
              color,
            }}
          >
            {block.segments.map((segment, segmentIndex) => (
              <Text key={`${segment.text}-${segmentIndex}`} style={{ fontWeight: segment.bold ? '600' : undefined, color: segment.bold ? ai.ink : color }}>
                {segment.text}
              </Text>
            ))}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <View style={{ alignSelf: 'flex-end', maxWidth: '86%' }}>
      <LinearGradient
        colors={[ai.orange, ai.amber]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 18,
          borderBottomRightRadius: 6,
          paddingHorizontal: 14,
          paddingVertical: 9,
          shadowColor: ai.orange,
          shadowOpacity: 0.25,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
        }}
      >
        <Text selectable style={{ fontSize: 13, lineHeight: 20, color: '#ffffff' }}>{text}</Text>
      </LinearGradient>
    </View>
  );
}

export function AssistantRow({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, maxWidth: '96%' }}>
      <AIOrb size={AI_ORB_AVATAR} style={{ marginTop: 2 }} />
      <View
        style={{
          flex: 1,
          minWidth: 0,
          backgroundColor: ai.surface,
          borderWidth: 1,
          borderColor: ai.hairlineSoft,
          borderRadius: 18,
          borderTopLeftRadius: 6,
          paddingHorizontal: 14,
          paddingVertical: 9,
          shadowColor: '#000',
          shadowOpacity: 0.05,
          shadowRadius: 2,
          shadowOffset: { width: 0, height: 1 },
          elevation: 1,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** The blinking orange bar at the end of a draft, the web's .ai-stream-caret. */
export function StreamCaret() {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reducedMotion) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0, duration: 450, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [opacity, reducedMotion]);
  return (
    <Animated.View style={{ width: 2, height: 14, marginLeft: 2, marginTop: 3, borderRadius: 1, backgroundColor: ai.orange, opacity }} />
  );
}

/** "กำลังวิเคราะห์" with the light sweeping across it, the web's .ai-shimmer-text. */
export function ThinkingText({ text }: { text: string }) {
  const reducedMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1200, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion]);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Animated.View style={{ opacity }}>
        <Text style={{ fontSize: 13, fontWeight: '500', color: ai.orange }}>{text}</Text>
      </Animated.View>
    </View>
  );
}

/**
 * A thread before its messages arrive: question and answer shapes alternating,
 * the way the conversation will lay out, with the orb still moving and one
 * quiet line under them. It replaced a lone "กำลังเปิดแชท" bubble on an empty
 * canvas (14 ก.ย.), which made opening an old chat look like a new, empty one.
 */
export function ThreadSkeleton({ label }: { label: string }) {
  const userShape = (key: string, widthPercent: `${number}%`, lines: `${number}%`[]) => (
    <View key={key} style={{ alignSelf: 'flex-end', width: widthPercent }}>
      <LinearGradient
        colors={['rgba(249,115,22,0.20)', 'rgba(245,158,11,0.20)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 11, gap: 6 }}
      >
        {lines.map((line, index) => (
          <Bone key={index} width={line} height={10} style={{ backgroundColor: 'rgba(255,255,255,0.55)' }} />
        ))}
      </LinearGradient>
    </View>
  );
  const answerShape = (key: string, lines: `${number}%`[], orb: boolean) => (
    <View key={key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, maxWidth: '96%' }}>
      {orb ? <AIOrb size={AI_ORB_AVATAR} style={{ marginTop: 2 }} /> : <View style={{ width: AI_ORB_AVATAR }} />}
      <View style={{ flex: 1, backgroundColor: ai.surface, borderWidth: 1, borderColor: ai.hairlineSoft, borderRadius: 18, borderTopLeftRadius: 6, paddingHorizontal: 14, paddingVertical: 11, gap: 7 }}>
        {lines.map((line, index) => <Bone key={index} width={line} height={10} />)}
      </View>
    </View>
  );
  return (
    <SkeletonReveal label={label} style={{ gap: 14 }}>
      {userShape('u1', '64%', ['90%', '55%'])}
      {answerShape('a1', ['92%', '100%', '70%'], true)}
      {userShape('u2', '46%', ['80%'])}
      {answerShape('a2', ['85%', '60%'], false)}
      <View style={{ marginLeft: AI_ORB_AVATAR + 8 }}>
        <ThinkingText text={label} />
      </View>
    </SkeletonReveal>
  );
}

/** The hairline list of next questions under an answer, the web's AIFollowUpList. */
export function FollowUpList({
  heading,
  actions,
  disabled,
  onPress,
}: {
  heading: string;
  actions: AIGuidedAction[];
  disabled?: boolean;
  onPress: (action: AIGuidedAction) => void;
}) {
  if (actions.length === 0) return null;
  return (
    <View style={{ marginLeft: AI_ORB_AVATAR + 8, marginTop: -4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingBottom: 2 }}>
        <AppIcon name="sparkles" size={12} color="rgba(251,146,60,0.8)" />
        <Text style={{ fontSize: 11, fontWeight: '500', color: ai.faded, letterSpacing: 0.3 }}>{heading}</Text>
      </View>
      {actions.map((action, index) => {
        const isNav = Boolean(action.href);
        return (
          <Pressable
            key={action.id}
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => onPress(action)}
            style={({ pressed }) => ({
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              paddingHorizontal: 8,
              paddingVertical: 8,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: ai.hairlineSoft,
              borderRadius: 12,
              backgroundColor: pressed ? 'rgba(255,237,213,0.7)' : 'transparent',
              opacity: disabled ? 0.5 : 1,
            })}
          >
            <Text style={{ flex: 1, fontSize: 13, lineHeight: 19, color: isNav ? ai.deep : ai.muted, fontWeight: isNav ? '500' : '400' }}>
              {action.label}
            </Text>
            <View style={{ transform: [{ rotate: '45deg' }] }}>
              <AppIcon name="arrow-up-outline" size={16} color={isNav ? ai.orange : ai.ghost} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One-line outcome under a command: green check, grey dash, or red x. */
export function OutcomeLine({ tone, text }: { tone: 'good' | 'muted' | 'bad'; text: string }) {
  const colour = tone === 'good' ? ai.green : tone === 'bad' ? ai.dangerText : ai.faint;
  const icon = tone === 'good' ? 'checkmark' : tone === 'bad' ? 'close' : 'remove';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <AppIcon name={icon} size={15} color={tone === 'good' ? ai.greenIcon : colour} />
      <Text style={{ fontSize: 12.5, fontWeight: '500', color: colour, flexShrink: 1 }}>{text}</Text>
    </View>
  );
}
