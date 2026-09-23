import { can } from '@/src/lib/rbac';
import { WORKSPACE_HUB_ROUTE } from '@/src/lib/workspace-route';
import type { Membership } from '@/src/types/restaurant';

// The membership stays in the signature so every caller keeps passing it: the
// landing screen was per role until 2026-09-23 and may be again.
export function getDefaultWorkspaceRoute(_membership: Membership | null | undefined) {
  return WORKSPACE_HUB_ROUTE;
}

export function getWorkModeCopy(membership: Membership | null | undefined) {
  const roleName = membership?.role?.name ?? '';

  if (roleName === 'chef' && can(membership, 'view_kitchen')) {
    return {
      title: 'โหมดครัว',
      hint: 'เปิดคิวครัวไว้เพื่อดูออเดอร์ที่ส่งเข้ามาและอัปเดตสถานะอาหาร',
    };
  }

  if (roleName === 'waiter') {
    return {
      title: 'โหมดหน้าร้าน',
      hint: 'เริ่มจากเลือกโต๊ะ เปิดออเดอร์ เพิ่มเมนู แล้วส่งเข้าครัว',
    };
  }

  if (roleName === 'cashier') {
    return {
      title: 'โหมดแคชเชียร์',
      hint: 'ติดตามออเดอร์ ออกบิล และบันทึกการชำระเงินจากมือถือ',
    };
  }

  if (roleName === 'owner' || roleName === 'manager') {
    return {
      title: 'โหมดเจ้าของร้าน',
      hint: 'ดูภาพรวมร้าน จัดการเมนู โต๊ะ พนักงาน และรายงานจากแอพเดียว',
    };
  }

  return {
    title: 'โหมดทำงาน',
    hint: 'ระบบจะแสดงเครื่องมือที่ตรงกับสิทธิ์ของบัญชีนี้',
  };
}
