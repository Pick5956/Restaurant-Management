import { useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppRefreshControl, AppScreen } from '@/src/components/app-shell';
import { StageBand, StageHomeRow, StageTakings } from '@/src/components/hub/stage-band';
import { StageShelf } from '@/src/components/hub/stage-shelf';
import { FloorTile, KitchenTile, OrdersTile, STAGE_TILE_INSET, type StageTileVariant } from '@/src/components/hub/stage-tiles';
import { MotionReveal } from '@/src/components/motion';
import {
  pairStacks,
  shelfLayout,
  stageActivity,
  stageContentWidth,
  stageHeartbeat,
  stageShelfGroups,
  stageTileRows,
  valueLines,
  type StageTileKey,
} from '@/src/lib/hub-stage-layout';
import type { HubLayoutProps, HubNavItem } from '@/src/lib/hub-types';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { readLastFloorTables, writeLastFloorTables } from '@/src/storage/hub-floor-store';
import { breakpoints, spacing } from '@/src/theme';

// Layout B, "เวที" (hub-final.json, runnerUp; owner, 2026-09-23: build both on
// the phone, then pick one). A warm stage from the top edge carries the shop
// and today's takings; raised service tiles straddle its foot; the occasional
// tools drop to a flat shelf of chips. Everything comes from props - this
// layout never fetches - and every tap goes through onOpen. How the tiles
// pair, how the shelf splits and where the heartbeat sits are decided from the
// measured column and the OS text size in hub-stage-layout.ts.

/**
 * AppScreen caps its column at a max width. The stage has to reach both edges
 * of the scroll view, so the column is left uncapped here and each section caps
 * itself at the layout's own width instead.
 */
const UNCAPPED = 100000;
/**
 * app-shell's tablet rail (PrimaryTabletRail), for the first frame's guess at
 * the column only: the column's own onLayout replaces it.
 */
const RAIL_WIDTH = 92;
const EXPANDED_RAIL_WIDTH = 232;

type Metrics = {
  contentMax: number;
  logo: number;
  /** How far the tiles reach up over the stage's foot. */
  overlap: number;
  tileGap: number;
  chipHeight: number;
};

const PHONE: Metrics = { contentMax: 720, logo: 48, overlap: 48, tileGap: 10, chipHeight: 60 };
/** From tabletWorkspace (900) up, where the hub already went to 980. */
const ROOMY: Metrics = { contentMax: 980, logo: 56, overlap: 56, tileGap: 12, chipHeight: 64 };

export function HubStage({ shop, items, data, showTakings, onOpen, footer }: HubLayoutProps) {
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The hub stays mounted under every page pushed over it; the light bar must
  // not outlive its focus, or every other screen gets white icons on white.
  const focused = useIsFocused();
  const { copy } = useDisplayPreferences();
  const restaurantId = useAuth().activeMembership?.restaurant_id ?? null;
  const [measuredWidth, setMeasuredWidth] = useState(0);

  const isTablet = width >= breakpoints.tablet;
  const roomy = width >= breakpoints.tabletWorkspace;
  const metrics = roomy ? ROOMY : PHONE;
  // AppScreen's own gutter, which the stage breaks out of.
  const gutter = isTablet ? spacing.xxl : spacing.lg;
  const railGuess = width >= breakpoints.expandedRail ? EXPANDED_RAIL_WIDTH : isTablet ? RAIL_WIDTH : 0;
  // The column as measured, so the rail beside it on a tablet is already out of it.
  const contentWidth = measuredWidth > 0 ? measuredWidth : stageContentWidth(width, gutter, metrics.contentMax, railGuess);
  const stackPair = pairStacks(contentWidth, fontScale);
  const shelf = shelfLayout(contentWidth, fontScale);
  const lines = valueLines(fontScale);

  // The table count this restaurant's floor last showed on this device, so the
  // floor bone is drawn at the strip's real height (two rows past 30 tables)
  // from the first frame of a cold start, and nothing jumps when the value lands.
  const floorTables = data.floor.status === 'ready' && data.floor.value ? data.floor.value.cells.length : null;
  useEffect(() => {
    if (restaurantId !== null && floorTables !== null) writeLastFloorTables(restaurantId, floorTables);
  }, [floorTables, restaurantId]);
  const boneTables = restaurantId !== null ? readLastFloorTables(restaurantId) : null;

  const byKey = new Map<string, HubNavItem>(items.map((item) => [item.key, item]));
  const home = byKey.get('home') ?? null;
  const rows = stageTileRows(items.map((item) => item.key), data.paidToday.status !== 'off');
  const hasTiles = rows.length > 0;
  const takingsShown = Boolean(home) && showTakings && data.takings.status !== 'off';

  // One heartbeat per screen, and only while there is work: the now-dot when
  // the stage's curve rises, otherwise the first tile's icon ring.
  const activity = stageActivity(data.floor, data.kitchen);
  const heartbeat = stageHeartbeat(activity, takingsShown, data.takings, rows);

  const renderTile = (key: StageTileKey, variant: StageTileVariant) => {
    const item = byKey.get(key);
    if (!item) return null;
    const beats = heartbeat.tile === key;
    if (key === 'pos') {
      return (
        <FloorTile
          boneTables={boneTables}
          heartbeat={beats}
          item={item}
          lines={lines}
          onOpen={onOpen}
          slot={data.floor}
          stripWidth={Math.max(0, contentWidth - STAGE_TILE_INSET)}
        />
      );
    }
    if (key === 'kitchen') {
      return <KitchenTile heartbeat={beats} item={item} lines={lines} onOpen={onOpen} slot={data.kitchen} variant={variant} />;
    }
    return <OrdersTile heartbeat={beats} item={item} onOpen={onOpen} slot={data.paidToday} variant={variant} />;
  };

  let revealIndex = 0;
  const nextDelay = () => {
    const delay = revealIndex * 40;
    revealIndex += 1;
    return delay;
  };

  const tiles = hasTiles ? (
    // A sibling after the stage, never its child: later in the tree is drawn
    // over it, and the tiles' shadows are not clipped by its rounded foot.
    <View style={{ marginTop: -metrics.overlap, gap: metrics.tileGap }}>
      {rows.map((row) => (row.kind === 'wide' ? (
        <MotionReveal delay={nextDelay()} key={row.key}>
          {renderTile(row.key, 'wide')}
        </MotionReveal>
      ) : (
        <View key="pair" style={{ flexDirection: stackPair ? 'column' : 'row', alignItems: 'stretch', gap: metrics.tileGap }}>
          <MotionReveal delay={nextDelay()} style={stackPair ? undefined : { flex: 1.4, minWidth: 0 }}>
            {renderTile('kitchen', 'pair')}
          </MotionReveal>
          <MotionReveal delay={nextDelay()} style={stackPair ? undefined : { flex: 1, minWidth: 0 }}>
            {renderTile('orders', stackPair ? 'wide' : 'pair')}
          </MotionReveal>
        </View>
      )))}
    </View>
  ) : null;

  const groups = stageShelfGroups(items);

  return (
    <AppScreen
      contentMaxWidth={UNCAPPED}
      contentStyle={{ gap: 0 }}
      hideTitle
      immersive
      // Android pulls this. iOS cannot yet: AppScreen turns the rubber band off
      // on an immersive screen, and a refresh control needs the overscroll.
      refreshControl={<AppRefreshControl onRefresh={data.refresh} progressViewOffset={insets.top} />}
      title={copy('หน้าหลัก', 'Home')}
      topLevel
    >
      {focused ? <StatusBar style="light" /> : null}
      <StageBand
        bleed={gutter}
        bottomRoom={hasTiles ? 14 + metrics.overlap : 20}
        contentMaxWidth={metrics.contentMax}
        // The glow rests only once the shop is known to be idle; while values
        // are still arriving the stage looks as full as it will.
        glow={activity !== 'idle'}
        logoSize={metrics.logo}
        shop={shop}
        topInset={insets.top}
      >
        {home && takingsShown ? (
          <StageTakings item={home} onOpen={onOpen} pulse={heartbeat.curve} slot={data.takings} />
        ) : home ? (
          <StageHomeRow item={home} onOpen={onOpen} />
        ) : null}
      </StageBand>
      <View
        onLayout={(event) => {
          const next = event.nativeEvent.layout.width;
          setMeasuredWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
        }}
        style={{ width: '100%', maxWidth: metrics.contentMax, alignSelf: 'center' }}
      >
        {tiles}
        {groups.length ? (
          <MotionReveal delay={120} style={{ marginTop: hasTiles ? spacing.xxl : spacing.xl }}>
            <StageShelf
              chipHeight={metrics.chipHeight}
              columns={shelf.columns}
              data={data}
              groups={groups}
              onOpen={onOpen}
              sideBySide={shelf.sideBySide}
            />
          </MotionReveal>
        ) : null}
        {footer ? <View style={{ marginTop: spacing.xxl }}>{footer}</View> : null}
      </View>
    </AppScreen>
  );
}
