import type { ReactNode } from 'react';
import { Pressable, Switch, View, type SwitchProps } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { money } from '@/src/lib/format';
import { menuManageStock, menuStockWords, type MenuManageStock } from '@/src/lib/menu-manage';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette, radius, spacing, typeScale } from '@/src/theme';
import type { MenuItem } from '@/src/types/menu';

/** The switch track when off, the same warm grey as the form rows' SwitchRow. */
const OFF_TRACK = '#E4D8CD';

type BrandSwitchProps = Omit<SwitchProps, 'trackColor' | 'thumbColor' | 'ios_backgroundColor'>;

/**
 * RN's Switch in the app's colours: orange when on, warm grey when off, a white
 * thumb. A bare Switch draws Android's own teal, which is what the menu screen
 * showed. Same values as SwitchRow (form/parts.tsx), whose row layout does not
 * fit a tile. Everything but the colours is forwarded.
 */
export function BrandSwitch(props: BrandSwitchProps) {
  return (
    <Switch
      {...props}
      ios_backgroundColor={OFF_TRACK}
      thumbColor="#fff"
      trackColor={{ false: OFF_TRACK, true: palette.primary }}
    />
  );
}

/**
 * What is left beside the price, drawn as the order screen's dish tile draws it
 * (owner, 2026-09-19 and 09-22): a plain grey word for sold out, amber at ten or
 * fewer, a quiet grey otherwise, and "ไม่จำกัด" for a dish with no recipe.
 */
function StockMark({ stock, words }: { stock: MenuManageStock; words: string }) {
  if (stock.kind === 'out') {
    return (
      <Text selectable style={[typeScale.caption, { flexShrink: 0, color: palette.neutral, fontWeight: '600' }]}>
        {words}
      </Text>
    );
  }
  const low = stock.kind === 'low';
  return (
    <View style={{ flexShrink: 0, borderRadius: radius.sm, backgroundColor: low ? palette.warningSoft : palette.surfaceSubtle, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text
        maxFontSizeMultiplier={1.2}
        style={[typeScale.caption, { color: low ? palette.warning : palette.muted, fontWeight: '700', fontVariant: ['tabular-nums'] }]}
      >
        {words}
      </Text>
    </View>
  );
}

/**
 * One dish on the menu manager: photo, name, price with its stock, and the
 * พร้อมขาย switch under them. The photo arrives as a slot so the screen keeps
 * the MenuImage call (the shared image policy is asserted on the screen's source).
 */
export function MenuManageTile({
  item,
  image,
  canManage,
  switchDisabled,
  tabletWorkspace,
  onOpen,
  onToggle,
}: {
  item: MenuItem;
  image: ReactNode;
  canManage: boolean;
  switchDisabled: boolean;
  tabletWorkspace: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const { copy, language } = useDisplayPreferences();
  const price = money(item.price, language);
  const stock = menuManageStock(item);
  const stockWords = menuStockWords(stock, language === 'en' ? 'en' : 'th');

  return (
    <View
      style={{
        minWidth: 0,
        // Phones get an exact two-column grid. A grow factor here fights the
        // column width and stretches a lone card on the last row across the
        // screen, which reads as a different, more important item.
        width: tabletWorkspace ? undefined : '48%',
        flexGrow: 0,
        flexBasis: tabletWorkspace ? 240 : 'auto',
        maxWidth: tabletWorkspace ? 260 : undefined,
        gap: spacing.sm,
      }}
    >
      <Pressable
        accessibilityLabel={copy(`เมนู ${item.name}, ${price}, ${stockWords}`, `Menu item ${item.name}, ${price}, ${stockWords}`)}
        accessibilityRole={canManage ? 'button' : undefined}
        accessibilityState={{ disabled: !canManage }}
        disabled={!canManage}
        onPress={onOpen}
        style={({ pressed }) => ({ gap: spacing.sm, opacity: pressed ? 0.72 : 1 })}
      >
        {image}
        <View style={{ gap: spacing.xs, paddingHorizontal: spacing.xs }}>
          <Text selectable numberOfLines={2} style={typeScale.cardTitle}>{item.name}</Text>
          {/* The price at the order tile's size: at 18/800 it was the loudest
              line on the page, fifty times over, louder than the title. It
              wraps rather than truncates, as on the order tile: a large OS text
              size beside a stock chip must never cut a price to "฿1,2…". */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text selectable style={[typeScale.number, { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600' }]}>{price}</Text>
            <StockMark stock={stock} words={stockWords} />
          </View>
        </View>
      </Pressable>
      {/*
        The switch position is the status - a badge beside it would say the
        same thing twice. It stays rendered but disabled without manage
        rights, so a read-only account can still read availability. It sits
        outside the Pressable, so flipping it never opens the editor.
      */}
      <View
        style={{
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.xs,
        }}
      >
        <Text
          numberOfLines={1}
          style={[typeScale.caption, { minWidth: 0, flex: 1, color: palette.muted, fontWeight: '700' }]}
        >
          {copy('พร้อมขาย', 'Available')}
        </Text>
        <BrandSwitch
          accessibilityLabel={copy(`พร้อมขาย ${item.name}`, `${item.name} available`)}
          disabled={switchDisabled}
          onValueChange={onToggle}
          value={item.is_available}
        />
      </View>
    </View>
  );
}
