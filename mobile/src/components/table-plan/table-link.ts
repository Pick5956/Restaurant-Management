import { Linking, Share } from 'react-native';

import type { QrPaperMode, QrSlipContent } from '@/src/components/table-plan/use-qr-paper';
import { customerTableUrl } from '@/src/lib/public-web-url';
import { useToast } from '@/src/providers/toast-provider';
import type { RestaurantTable } from '@/src/types/table';

// What both faces of the table sheet do with the table's customer link.

export type QrPaper = {
  /** Share the image on both platforms; print too on Android. */
  run: (content: QrSlipContent, mode: QrPaperMode) => void;
  busy: boolean;
};

export type TableLink = {
  url: string | null;
  share: () => void;
  openMenu: () => void;
};

/** The customer link's two uses. The URL itself is never printed on screen: the token in it is the table's key. */
export function useTableLink(table: RestaurantTable, label: string, t: (th: string, en: string) => string): TableLink {
  const { showToast } = useToast();
  const token = String(table.customer_token ?? '').trim();
  const url = token ? customerTableUrl(token) : null;
  return {
    url,
    share: () => {
      if (!url) return;
      void Share.share({
        message: `${t(`สแกนหรือเปิดลิงก์นี้เพื่อสั่งอาหารที่โต๊ะ ${label}`, `Scan or open this link to order at table ${label}`)}\n${url}`,
      }).catch(() => undefined);
    },
    openMenu: () => {
      if (!url) return;
      Linking.openURL(url).catch(() => {
        showToast({ tone: 'error', title: t('เปิดเมนูไม่สำเร็จ', 'Could not open the menu') });
      });
    },
  };
}
