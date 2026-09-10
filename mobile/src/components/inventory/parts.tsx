import { GlassView } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet, GlassButton, GlassHeaderPane, LIQUID_GLASS } from '@/src/components/ai/chrome';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { GlassLayer } from '@/src/components/ui';
import type { DisplayLanguage } from '@/src/lib/display-preferences';
import { money } from '@/src/lib/format';
import { countPayload, quickAmounts, restockStep, stockShare, stockStatus, type StockStatus } from '@/src/lib/inventory-list';
import { palette } from '@/src/theme';
import type { Ingredient } from '@/src/types/ingredient';

// The inventory screens' pieces, built the way the design page was drawn: one
// shape per piece, two materials. On iOS 26 the cards, rails and buttons are
// Liquid Glass; everywhere else the same shapes are cream with a pale orange
// edge and a warm shadow doing the work the glass does. Every colour is the
// app's own palette — nothing new was added for this screen.

export const HEADER_BUTTON = 46;
export const HEADER_FADE = 15;
const HEADER_PAD_TOP = 4;
const RAIL_HEIGHT = 46;

export function fmt(value: number | string, locale: string, digits = 2): string {
  return Number(value).toLocaleString(locale, { maximumFractionDigits: digits });
}

export function statusLabel(status: StockStatus, language: DisplayLanguage): string {
  if (status === 'out') return language === 'th' ? 'หมด' : 'Out';
  if (status === 'low') return language === 'th' ? 'ใกล้หมด' : 'Low';
  return language === 'th' ? 'พอใช้' : 'OK';
}

export function statusColour(status: StockStatus): { ink: string; soft: string } {
  if (status === 'out') return { ink: palette.danger, soft: palette.dangerSoft };
  if (status === 'low') return { ink: palette.warning, soft: palette.warningSoft };
  return { ink: palette.success, soft: palette.successSoft };
}

/** A card: glass on iOS 26, cream with a pale edge everywhere else. */
export function Card({ children, style, radius = 22 }: { children: ReactNode; style?: StyleProp<ViewStyle>; radius?: number }) {
  return (
    <GlassLayer
      style={{ borderRadius: radius, ...(style as object) }}
      tint="rgba(255,255,255,0.42)"
      fallback={palette.surface}
      fallbackBorder={palette.border}
    >
      {children}
    </GlassLayer>
  );
}

/**
 * The floating header: the glass pane, a back button, a title and an optional
 * rail underneath (the status segments). Everything below scrolls under it, so
 * the screen has to start its content at `headerContentTop`.
 */
export function headerContentTop(insetsTop: number, withRail: boolean): number {
  return insetsTop + HEADER_PAD_TOP + HEADER_BUTTON + (withRail ? 8 + RAIL_HEIGHT : 0) + HEADER_FADE + 10;
}

export function FloatingHeader({
  title,
  subtitle,
  onBack,
  backLabel,
  backIcon = 'chevron-back',
  trailing,
  rail,
  centered,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  backLabel: string;
  /** "close" when the header is leaving a mode rather than a screen. */
  backIcon?: AppIconName;
  trailing?: ReactNode;
  rail?: ReactNode;
  centered?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const solidTo = HEADER_PAD_TOP + HEADER_BUTTON + (rail ? 8 + RAIL_HEIGHT : 0);
  return (
    <>
      <GlassHeaderPane top={insets.top} solidTo={solidTo} fade={HEADER_FADE} />
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3, paddingTop: insets.top + HEADER_PAD_TOP, paddingHorizontal: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <GlassButton icon={backIcon} label={backLabel} onPress={onBack} />
          <View style={{ flex: 1, minWidth: 0, alignItems: centered ? 'center' : 'flex-start' }}>
            <Text numberOfLines={1} style={{ fontSize: centered ? 18 : 24, fontWeight: '700', color: palette.textStrong, lineHeight: centered ? 24 : 30 }}>{title}</Text>
            {subtitle ? <Text numberOfLines={1} style={{ fontSize: 12.5, color: palette.muted, marginTop: 1 }}>{subtitle}</Text> : null}
          </View>
          {trailing ?? <View style={{ width: HEADER_BUTTON, height: HEADER_BUTTON }} />}
        </View>
        {rail ? <View style={{ marginTop: 8 }}>{rail}</View> : null}
      </View>
    </>
  );
}

/** The three-way status rail. On the rail the chosen cell is the only bright thing. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: 16, height: RAIL_HEIGHT, backgroundColor: LIQUID_GLASS ? 'rgba(255,237,213,0.55)' : palette.surfaceStrong }}>
      {options.map((option) => {
        const on = option.value === value;
        const inner = (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Text style={{ fontSize: 13.5, fontWeight: '600', color: on ? '#FFFFFF' : palette.muted }}>{option.label}</Text>
            {option.count !== undefined ? (
              <Text style={{ fontSize: 13.5, fontWeight: '600', color: on ? 'rgba(255,255,255,0.8)' : palette.placeholder, fontVariant: ['tabular-nums'] }}>{option.count}</Text>
            ) : null}
          </View>
        );
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(option.value)}
            style={{ flex: 1 }}
          >
            {on ? (
              <View style={{ flex: 1, borderRadius: 12, backgroundColor: palette.textStrong, flexDirection: 'row', shadowColor: '#3d2b1f', shadowOpacity: 0.22, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}>
                {inner}
              </View>
            ) : (
              <View style={{ flex: 1, flexDirection: 'row' }}>{inner}</View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export function TotalsCard({ value, needsOrder, language }: { value: number; needsOrder: number; language: DisplayLanguage }) {
  return (
    <Card style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
      <View>
        <Text style={{ fontSize: 11.5, color: palette.muted }}>{language === 'th' ? 'มูลค่าคลังรวม' : 'Inventory value'}</Text>
        <Text style={{ fontSize: 22, fontWeight: '600', color: palette.textStrong, fontVariant: ['tabular-nums'], lineHeight: 28 }}>{money(value, language)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 11.5, color: palette.muted }}>{language === 'th' ? 'ต้องสั่งของ' : 'To reorder'}</Text>
        <Text style={{ fontSize: 22, fontWeight: '600', color: palette.primaryInk, fontVariant: ['tabular-nums'], lineHeight: 28 }}>
          {needsOrder}
          <Text style={{ fontSize: 11.5, fontWeight: '500', color: palette.muted }}> {language === 'th' ? 'รายการ' : 'items'}</Text>
        </Text>
      </View>
    </Card>
  );
}

export function StatusPill({ status, language }: { status: StockStatus; language: DisplayLanguage }) {
  const colour = statusColour(status);
  return (
    <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: colour.soft }}>
      <Text style={{ fontSize: 11, fontWeight: '600', color: colour.ink }}>{statusLabel(status, language)}</Text>
    </View>
  );
}

/**
 * The level bar: how the stock stands against its reorder level. The tick at
 * the middle is the level itself, so a bar past it is fine and one short of it
 * is not — colour and length agreeing, which the days-of-cover bar could not.
 */
export function LevelBar({ item, height = 6 }: { item: Ingredient; height?: number }) {
  const share = stockShare(item);
  const status = stockStatus(item);
  if (share === null) return null;
  return (
    <View style={{ marginTop: 8, height, borderRadius: height / 2, backgroundColor: palette.surfaceStrong }}>
      <View style={{ width: `${Math.round(share * 100)}%`, height: '100%', borderRadius: height / 2, backgroundColor: statusColour(status).ink }} />
      <View style={{ position: 'absolute', left: '50%', top: -3, width: 2, height: height + 6, borderRadius: 1, backgroundColor: palette.muted, opacity: 0.5 }} />
    </View>
  );
}

export function CheckBox({ checked }: { checked: boolean }) {
  return (
    <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: checked ? palette.primary : palette.border, backgroundColor: checked ? palette.primary : 'transparent', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
      {checked ? <AppIcon name="checkmark" size={15} color={palette.primaryText} /> : null}
    </View>
  );
}

/** A 44px rounded-square button: solid orange for the primary act, glass for the rest. */
export function SquareButton({ icon, label, onPress, primary, disabled, size = 44 }: { icon: AppIconName; label: string; onPress: () => void; primary?: boolean; disabled?: boolean; size?: number }) {
  const shape = { width: size, height: size, borderRadius: Math.round(size * 0.32), alignItems: 'center' as const, justifyContent: 'center' as const };
  if (primary) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={4} style={({ pressed }) => ({ opacity: pressed ? 0.85 : disabled ? 0.5 : 1 })}>
        {LIQUID_GLASS ? (
          <GlassView glassEffectStyle="regular" isInteractive colorScheme="light" tintColor="rgba(194,65,12,0.86)" style={shape}>
            <AppIcon name={icon} size={Math.round(size * 0.5)} color="#ffffff" />
          </GlassView>
        ) : (
          <View style={{ ...shape, backgroundColor: palette.primary, shadowColor: palette.primary, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 }}>
            <AppIcon name={icon} size={Math.round(size * 0.5)} color="#ffffff" />
          </View>
        )}
      </Pressable>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={4} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <GlassLayer style={shape} fallback={palette.surface} fallbackBorder={palette.border}>
        <AppIcon name={icon} size={Math.round(size * 0.45)} color={palette.muted} />
      </GlassLayer>
    </Pressable>
  );
}

export function IngredientCard({
  item,
  language,
  locale,
  selecting,
  selected,
  canManage,
  onPress,
  onRestock,
  onMore,
}: {
  item: Ingredient;
  language: DisplayLanguage;
  locale: string;
  selecting: boolean;
  selected: boolean;
  canManage: boolean;
  onPress: () => void;
  onRestock: () => void;
  onMore: () => void;
}) {
  const status = stockStatus(item);
  const colour = statusColour(status);
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  return (
    <Card style={{ padding: 12, flexDirection: 'row', gap: 10, ...(selected ? { borderWidth: 1.5, borderColor: palette.primary } : {}) }}>
      {selecting ? <CheckBox checked={selected} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selecting ? t(`เลือก ${item.name}`, `Select ${item.name}`) : t(`ดู ${item.name}`, `View ${item.name}`)}
        onPress={onPress}
        style={({ pressed }) => ({ flex: 1, minWidth: 0, opacity: pressed ? 0.7 : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 15.5, fontWeight: '600', color: palette.textStrong }}>{item.name}</Text>
          <StatusPill status={status} language={language} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
          <Text style={{ fontSize: 22, fontWeight: '600', color: status === 'ok' ? palette.textStrong : colour.ink, fontVariant: ['tabular-nums'], lineHeight: 28 }}>{fmt(item.stock, locale)}</Text>
          <Text style={{ fontSize: 12, color: palette.muted }}>{item.unit}</Text>
          <Text style={{ marginLeft: 'auto', fontSize: 12, color: palette.muted, fontVariant: ['tabular-nums'] }}>฿{fmt(item.cost_per_unit, locale)} / {item.unit}</Text>
        </View>
        <LevelBar item={item} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <Text numberOfLines={1} style={{ maxWidth: '50%', fontSize: 11.5, fontWeight: '600', color: palette.muted }}>{item.category?.name ?? t('ไม่มีหมวด', 'Uncategorised')}</Text>
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: palette.placeholder }}>
            {Number(item.min_stock) > 0 ? t(`ขั้นต่ำ ${fmt(item.min_stock, locale)} ${item.unit}`, `Min ${fmt(item.min_stock, locale)} ${item.unit}`) : t('ยังไม่ตั้งขั้นต่ำ', 'No reorder level')}
          </Text>
          {!selecting ? <AppIcon name="chevron-forward" size={16} color={palette.placeholder} /> : null}
        </View>
      </Pressable>
      {!selecting && canManage ? (
        <View style={{ justifyContent: 'center', gap: 6 }}>
          <SquareButton primary icon="add" label={t('เติมสต็อก', 'Restock')} onPress={onRestock} />
          <SquareButton icon="ellipsis-horizontal" label={t('ตัวเลือก', 'Options')} onPress={onMore} />
        </View>
      ) : null}
    </Card>
  );
}

/** The bottom dock: a gradient fade so the list dissolves into it, then the buttons. */
export function Dock({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5 }}>
      <LinearGradient pointerEvents="none" colors={['rgba(255,247,237,0)', palette.canvas]} locations={[0, 0.55]} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 22, paddingBottom: Math.max(insets.bottom, 12) + 6 }}>{children}</View>
    </View>
  );
}

export function DockButton({ label, icon, onPress, secondary, disabled }: { label: string; icon?: AppIconName; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54 }}>
      {icon ? <AppIcon name={icon} size={20} color={secondary ? palette.textStrong : '#ffffff'} /> : null}
      <Text style={{ fontSize: 16, fontWeight: '600', color: secondary ? palette.textStrong : '#ffffff' }}>{label}</Text>
    </View>
  );
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ flex: 1, opacity: disabled ? 0.5 : pressed ? 0.88 : 1 })}>
      {secondary ? (
        <GlassLayer style={{ borderRadius: 27 }} fallback={palette.surface} fallbackBorder={palette.border}>{inner}</GlassLayer>
      ) : LIQUID_GLASS ? (
        <GlassView glassEffectStyle="regular" isInteractive colorScheme="light" tintColor="rgba(194,65,12,0.84)" style={{ borderRadius: 27, shadowColor: palette.primary, shadowOpacity: 0.32, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } }}>
          {inner}
        </GlassView>
      ) : (
        <View style={{ borderRadius: 27, backgroundColor: palette.primary, shadowColor: palette.primary, shadowOpacity: 0.32, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 6 }}>{inner}</View>
      )}
    </Pressable>
  );
}

// ----------------------------------------------------------------- sheets

export function SheetTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8, paddingRight: 64 }}>
      <Text style={{ fontSize: 16, fontWeight: '700', color: palette.textStrong }}>{title}</Text>
      {subtitle ? <Text style={{ fontSize: 12, color: palette.muted, marginTop: 1 }}>{subtitle}</Text> : null}
    </View>
  );
}

export function SheetAction({ icon, label, onPress, danger, divided }: { icon: AppIconName; label: string; onPress: () => void; danger?: boolean; divided?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 48,
        paddingHorizontal: 16,
        backgroundColor: pressed ? 'rgba(249,115,22,0.12)' : 'transparent',
        ...(divided ? { borderTopWidth: 1, borderTopColor: palette.divider, marginTop: 6, paddingTop: 6 } : {}),
      })}
    >
      <AppIcon name={icon} size={20} color={danger ? palette.danger : palette.muted} />
      <Text style={{ fontSize: 15, fontWeight: '500', color: danger ? palette.danger : palette.textStrong }}>{label}</Text>
    </Pressable>
  );
}

export function Stepper({ value, step, unit, onChange }: { value: number; step: number; unit: string; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const key = (icon: AppIconName, label: string, to: number, disabled?: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={() => onChange(Math.max(0, Math.round(to * 100) / 100))} style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.8 : 1 })}>
      <GlassLayer style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }} fallback={palette.surface} fallbackBorder={palette.border}>
        <AppIcon name={icon} size={24} color={palette.textStrong} />
      </GlassLayer>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 4 }}>
      {key('remove', '−', value - step, value <= 0)}
      <GlassLayer style={{ flex: 1, height: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 14, gap: 6 }} fallback={palette.surface} fallbackBorder={palette.border}>
        <TextInput
          value={text}
          onChangeText={(next) => { setText(next); const n = Number(next); if (Number.isFinite(n) && n >= 0) onChange(n); }}
          keyboardType="decimal-pad"
          selectTextOnFocus
          style={{ flex: 1, textAlign: 'right', fontSize: 20, fontWeight: '600', color: palette.textStrong, paddingVertical: 0 }}
        />
        <Text style={{ fontSize: 12, color: palette.muted }}>{unit}</Text>
      </GlassLayer>
      {key('add', '+', value + step)}
    </View>
  );
}

export function QuickChips({ amounts, value, onPick, prefix = '+' }: { amounts: number[]; value: number; onPick: (amount: number) => void; prefix?: string }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginTop: 10 }}>
      {amounts.map((amount) => {
        const on = amount === value;
        return (
          <Pressable key={amount} accessibilityRole="button" onPress={() => onPick(amount)} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
            {on ? (
              <View style={{ height: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: palette.primary, justifyContent: 'center' }}>
                <Text style={{ fontSize: 13.5, fontWeight: '600', color: '#fff' }}>{prefix}{amount.toLocaleString('th-TH')}</Text>
              </View>
            ) : (
              <GlassLayer style={{ height: 36, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center' }} fallback={palette.surface} fallbackBorder={palette.border}>
                <Text style={{ fontSize: 13.5, fontWeight: '500', color: palette.text }}>{prefix}{amount.toLocaleString('th-TH')}</Text>
              </GlassLayer>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export function KeyValue({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  return (
    <View style={{ marginHorizontal: 16, marginTop: 12, borderRadius: 14, backgroundColor: LIQUID_GLASS ? 'rgba(255,237,213,0.55)' : palette.surfaceStrong, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ fontSize: 13.5, color: palette.muted }}>{label}</Text>
      <Text style={{ fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'], color: tone === 'ok' ? palette.success : tone === 'bad' ? palette.danger : palette.textStrong }}>{value}</Text>
    </View>
  );
}

export function SheetFooter({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 16 }}>{children}</View>;
}

export function SheetButton({ label, onPress, secondary, disabled }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ flex: 1, opacity: disabled ? 0.5 : pressed ? 0.88 : 1 })}>
      {secondary ? (
        <GlassLayer style={{ height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' }} fallback={palette.surface} fallbackBorder={palette.border}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: palette.textStrong }}>{label}</Text>
        </GlassLayer>
      ) : (
        <View style={{ height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: LIQUID_GLASS ? 'rgba(194,65,12,0.9)' : palette.primary }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#fff' }}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * Restock: a stepper in the ingredient's own unit, four one-tap amounts, and
 * what the shelf will hold afterwards. If the ingredient has a unit cost the
 * sheet says what the restock will cost, because the API writes that as an
 * expense — money nobody typed should still be money everybody saw.
 */
export function RestockSheet({
  item,
  open,
  onClose,
  onSubmit,
  busy,
  language,
  locale,
}: {
  item: Ingredient | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (quantity: number) => void;
  busy: boolean;
  language: DisplayLanguage;
  locale: string;
}) {
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  const [amount, setAmount] = useState(0);
  useEffect(() => { if (open && item) setAmount(restockStep(item)); }, [open, item]);
  if (!item) return null;
  const cost = Number(item.cost_per_unit) * amount;
  return (
    <BottomSheet open={open} onClose={onClose} heightFraction={0.62} label={t('ปิด', 'Close')} showClose>
      <SheetTitle title={t('เติมสต็อก', 'Restock')} subtitle={t(`${item.name} · ตอนนี้ ${fmt(item.stock, locale)} ${item.unit}`, `${item.name} · now ${fmt(item.stock, locale)} ${item.unit}`)} />
      <Stepper value={amount} step={restockStep(item)} unit={item.unit} onChange={setAmount} />
      <QuickChips amounts={quickAmounts(item)} value={amount} onPick={setAmount} />
      <KeyValue label={t('คงเหลือหลังเติม', 'Stock after')} value={`${fmt(Number(item.stock) + amount, locale)} ${item.unit}`} />
      {cost > 0 ? <KeyValue label={t('จะบันทึกรายจ่าย', 'Expense recorded')} value={money(cost, language)} /> : null}
      <SheetFooter>
        <SheetButton label={t(`บันทึก +${fmt(amount, locale)} ${item.unit}`, `Save +${fmt(amount, locale)} ${item.unit}`)} onPress={() => onSubmit(amount)} disabled={busy || amount <= 0} />
      </SheetFooter>
    </BottomSheet>
  );
}

/** Set the counted quantity. Zero is allowed and means the shelf is empty. */
export function CountSheet({
  item,
  open,
  onClose,
  onSubmit,
  busy,
  language,
  locale,
}: {
  item: Ingredient | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: NonNullable<ReturnType<typeof countPayload>> | null) => void;
  busy: boolean;
  language: DisplayLanguage;
  locale: string;
}) {
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  const [amount, setAmount] = useState(0);
  useEffect(() => { if (open && item) setAmount(Number(item.stock)); }, [open, item]);
  if (!item) return null;
  const difference = amount - Number(item.stock);
  return (
    <BottomSheet open={open} onClose={onClose} heightFraction={0.58} label={t('ปิด', 'Close')} showClose>
      <SheetTitle title={t('ปรับยอด (นับจริง)', 'Set counted quantity')} subtitle={item.name} />
      <Stepper value={amount} step={restockStep(item)} unit={item.unit} onChange={setAmount} />
      <KeyValue
        label={t('ส่วนต่าง', 'Difference')}
        value={`${difference > 0 ? '+' : ''}${fmt(difference, locale)} ${item.unit}`}
        tone={difference > 0 ? 'ok' : difference < 0 ? 'bad' : undefined}
      />
      {amount === 0 ? (
        <Text style={{ paddingHorizontal: 16, marginTop: 8, fontSize: 11.5, color: palette.placeholder }}>{t('นับได้ 0 จะบันทึกเป็นการตัดออกทั้งหมด', 'A count of 0 is saved as removing everything')}</Text>
      ) : null}
      <SheetFooter>
        <SheetButton label={t('บันทึกยอดที่นับได้', 'Save counted quantity')} onPress={() => onSubmit(countPayload(item, amount))} disabled={busy} />
      </SheetFooter>
    </BottomSheet>
  );
}

/** A short text action in the header, the same material as the round buttons. */
export function HeaderTextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <GlassLayer style={{ height: HEADER_BUTTON, paddingHorizontal: 14, borderRadius: HEADER_BUTTON / 2, justifyContent: 'center' }} fallback={palette.surface} fallbackBorder={palette.border}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: palette.textStrong }}>{label}</Text>
      </GlassLayer>
    </Pressable>
  );
}

/** The search capsule: a magnifier, the field and a clear button, in the card material. */
export function SearchCapsule({ value, onChangeText, placeholder, clearLabel }: { value: string; onChangeText: (value: string) => void; placeholder: string; clearLabel: string }) {
  return (
    <GlassLayer style={{ flex: 1, height: 50, borderRadius: 25, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 8, gap: 8 }} fallback={palette.surface} fallbackBorder={palette.border}>
      <AppIcon name="search-outline" size={18} color={palette.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.placeholder}
        returnKeyType="search"
        clearButtonMode="never"
        style={{ flex: 1, fontSize: 15, color: palette.textStrong, paddingVertical: 0 }}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel={clearLabel} onPress={() => onChangeText('')} hitSlop={8} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <AppIcon name="close-circle" size={18} color={palette.placeholder} />
        </Pressable>
      ) : null}
    </GlassLayer>
  );
}

/** A choice chip for the filter sheet: solid orange when on, the card material when not. */
export function ChoiceChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      {on ? (
        <View style={{ height: 38, paddingHorizontal: 14, borderRadius: 999, backgroundColor: palette.primary, justifyContent: 'center' }}>
          <Text style={{ fontSize: 13.5, fontWeight: '600', color: '#fff' }}>{label}</Text>
        </View>
      ) : (
        <GlassLayer style={{ height: 38, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center' }} fallback={palette.surface} fallbackBorder={palette.border}>
          <Text style={{ fontSize: 13.5, fontWeight: '500', color: palette.text }}>{label}</Text>
        </GlassLayer>
      )}
    </Pressable>
  );
}

export function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: palette.muted, letterSpacing: 0.2, marginBottom: 8 }}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}

// ------------------------------------------------------------ dates

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** "10 ก.ย. 69" / "10 Sep 2026". */
export function shortDate(iso: string | undefined, language: DisplayLanguage): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  if (language === 'th') return `${date.getDate()} ${THAI_MONTHS[date.getMonth()]} ${String(date.getFullYear() + 543).slice(-2)}`;
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function shortTime(iso: string | undefined, language: DisplayLanguage): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(language === 'th' ? 'th-TH' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** The day heading over a run of history rows: "วันนี้ · 10 ก.ย. 69", "เมื่อวาน · …", or the date alone. */
export function dayHeading(iso: string | undefined, language: DisplayLanguage, now = new Date()): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  const label = shortDate(iso, language);
  if (days === 0) return language === 'th' ? `วันนี้ · ${label}` : `Today · ${label}`;
  if (days === 1) return language === 'th' ? `เมื่อวาน · ${label}` : `Yesterday · ${label}`;
  return label;
}

export function dayKey(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
