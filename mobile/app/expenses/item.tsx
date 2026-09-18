import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { createExpense, deleteExpense, updateExpense } from '@/src/api/expense';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { CATEGORY_LOOK } from '@/src/components/expenses/parts';
import { ChoiceChips, DangerAction, DayPickerSheet, Field, FORM_MAX_WIDTH, FormBody, FormCard, Note, SaveDock } from '@/src/components/form/parts';
import { StateMessage } from '@/src/components/mobile-screen';
import { Button, Feedback } from '@/src/components/ui';
import { expenseCategoryLabel, expenseDayLabel } from '@/src/lib/expense-view';
import { formatBangkokDate } from '@/src/lib/order-query';
import { can } from '@/src/lib/rbac';
import { addDays } from '@/src/lib/report-view';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, spacing } from '@/src/theme';
import { expenseCategories, type ExpenseCategory } from '@/src/types/expense';

// Adding or editing one expense, redrawn on 15 ก.ย. 2569. The date had been a
// box to type "ปปปป-ดด-วว" into. Now the amount is the orange block at the
// top with the number keyboard up at once, the category chips carry the
// list's icons, the date is today / yesterday / a calendar, and deleting is
// the quiet red line at the foot. An entry the stock intake wrote keeps its
// amount: that number is what was paid for the delivery.

function normalizeDate(value: string | undefined, today: string) {
  if (!value) return today;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : today;
}

export default function ExpenseItemScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const params = useLocalSearchParams<{ id?: string; category?: string; amount?: string; spent_at?: string; note?: string; from_stock?: string }>();
  const editingId = params.id ? Number(params.id) : null;
  const editing = editingId !== null && Number.isInteger(editingId) && editingId > 0;
  const fromStock = editing && params.from_stock === '1';
  const canEdit = can(activeMembership, 'manage_expenses');
  const tablet = width >= breakpoints.tabletWorkspace;
  const today = useMemo(() => formatBangkokDate(), []);

  const initialCategory = useMemo<ExpenseCategory>(() => {
    const value = params.category;
    return (expenseCategories as readonly string[]).includes(value ?? '') ? (value as ExpenseCategory) : 'ingredient';
  }, [params.category]);

  const [category, setCategory] = useState<ExpenseCategory>(initialCategory);
  const [amount, setAmount] = useState(params.amount ? String(params.amount) : '');
  const [spentAt, setSpentAt] = useState(normalizeDate(params.spent_at, today));
  const [note, setNote] = useState(params.note ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pickingDay, setPickingDay] = useState(false);
  const [amountFocused, setAmountFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = editing ? copy('แก้ไขค่าใช้จ่าย', 'Edit expense') : copy('เพิ่มค่าใช้จ่าย', 'Add expense');

  if (!canEdit) {
    return (
      <AppScreen title={title} topLevel={false} centerTitle>
        <StateMessage
          title={copy('ไม่มีสิทธิ์จัดการค่าใช้จ่าย', 'Expense management unavailable')}
          detail={copy('บัญชีนี้ต้องมีสิทธิ์จัดการค่าใช้จ่าย', 'This account needs permission to manage expenses.')}
        />
      </AppScreen>
    );
  }

  async function save() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError(copy('กรอกจำนวนเงินให้มากกว่า 0', 'Enter an amount greater than zero.'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { category, amount: value, spent_at: spentAt, note: note.trim() };
      if (editing && editingId !== null) {
        await updateExpense(editingId, payload);
      } else {
        await createExpense(payload);
      }
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy('บันทึกค่าใช้จ่ายไม่สำเร็จ', 'Could not save the expense.'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing || editingId === null) return;
    setSaving(true);
    setError(null);
    try {
      await deleteExpense(editingId);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy('ลบค่าใช้จ่ายไม่สำเร็จ', 'Could not delete the expense.'));
      setSaving(false);
    }
  }

  const yesterday = addDays(today, -1);
  const dayKey = spentAt === today ? 'today' : spentAt === yesterday ? 'yesterday' : 'other';
  const dayOptions = [
    { key: 'today', label: copy(`วันนี้ · ${expenseDayLabel(today, today, language).replace(/^.*· /, '')}`, `Today · ${expenseDayLabel(today, today, language).replace(/^.*· /, '')}`) },
    { key: 'yesterday', label: copy('เมื่อวาน', 'Yesterday') },
    { key: 'other', label: dayKey === 'other' ? expenseDayLabel(spentAt, today, language) : copy('เลือกวัน', 'Pick a day'), icon: 'calendar-outline' as const },
  ];
  const saveLabel = editing ? copy('บันทึกการแก้ไข', 'Save changes') : copy('เพิ่มค่าใช้จ่าย', 'Add expense');

  return (
    <AppScreen
      title={title}
      topLevel={false}
      centerTitle
      contentMaxWidth={tablet ? FORM_MAX_WIDTH : undefined}
      footer={!confirmDelete ? <SaveDock label={saveLabel} onPress={save} loading={saving} /> : undefined}
    >
      {error ? <Feedback title={copy('ทำรายการไม่ได้', 'Unable to complete the action')} detail={error} tone="danger" /> : null}
      <View style={{ gap: spacing.md }}>
        <LinearGradient colors={['#B93A0D', '#D9581F', '#EF7A35']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 20, borderCurve: 'continuous', paddingVertical: 14, paddingHorizontal: 16, opacity: amountFocused ? 1 : 0.97 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.9)' }}>{copy('จำนวนเงิน', 'Amount')}</Text>
            {fromStock ? (
              <View style={{ borderRadius: 999, paddingHorizontal: 7, backgroundColor: 'rgba(255,255,255,0.25)' }}>
                <Text style={{ fontSize: 10.5, lineHeight: 16, fontWeight: '600', color: '#fff' }}>{copy('จากสต๊อก', 'from stock')}</Text>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 20, lineHeight: 28, fontWeight: '600', color: 'rgba(255,255,255,0.9)' }}>฿</Text>
            <TextInput
              accessibilityLabel={copy('จำนวนเงิน (บาท)', 'Amount (THB)')}
              autoFocus={!editing}
              editable={!fromStock}
              keyboardAppearance="light"
              keyboardType="decimal-pad"
              onBlur={() => setAmountFocused(false)}
              onChangeText={(value) => { setAmount(value.replace(/[^\d.]/g, '')); setError(null); }}
              onFocus={() => setAmountFocused(true)}
              placeholder="0.00"
              placeholderTextColor="rgba(255,255,255,0.45)"
              selectionColor="#fff"
              style={{ flex: 1, fontSize: 20, lineHeight: 28, fontWeight: '600', color: '#fff', paddingVertical: 0, fontVariant: ['tabular-nums'] }}
              value={amount}
            />
          </View>
          {fromStock ? <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', marginTop: 4 }}>{copy('ยอดมาจากการรับของเข้าคลัง แก้ได้ที่คลังวัตถุดิบ', 'This amount came from a stock intake; change it in inventory')}</Text> : null}
        </LinearGradient>

        <FormCard title={copy('หมวด', 'Category')}>
          <FormBody>
            <ChoiceChips
              options={expenseCategories.map((value) => ({ key: value, label: expenseCategoryLabel(value, language), icon: CATEGORY_LOOK[value].icon, tint: CATEGORY_LOOK[value] }))}
              value={category}
              onChange={setCategory}
            />
          </FormBody>
        </FormCard>

        <FormCard title={copy('วันที่', 'Date')}>
          <FormBody>
            <ChoiceChips
              options={dayOptions}
              value={dayKey}
              onChange={(key) => {
                if (key === 'today') setSpentAt(today);
                else if (key === 'yesterday') setSpentAt(yesterday);
                else setPickingDay(true);
              }}
            />
          </FormBody>
        </FormCard>

        <FormCard title={copy('หมายเหตุ', 'Note')} detail={copy('ไม่บังคับ · ขึ้นเป็นชื่อรายการ', 'Optional · shown as the entry name')}>
          <FormBody>
            <Field value={note} onChangeText={setNote} icon="document-text-outline" placeholder={copy('เช่น ซื้อพริกป่น 2 กก. ตลาดเช้า', 'e.g. 2 kg chilli from the morning market')} maxLength={500} multiline />
          </FormBody>
        </FormCard>

        {!editing ? <Note text={copy('รายการที่รับของเข้าคลังจะถูกบันทึกให้เองในหมวดวัตถุดิบ ไม่ต้องเพิ่มซ้ำตรงนี้', 'Stock intakes are recorded here automatically under Ingredients; no need to add them again')} /> : null}

        {editing ? (
          <View style={{ paddingTop: spacing.sm }}>
            <DangerAction
              icon="trash-outline"
              label={copy('ลบรายการนี้', 'Delete this entry')}
              confirmLabel={copy('ยืนยันลบ', 'Confirm delete')}
              cancelLabel={copy('เก็บไว้', 'Keep it')}
              message={fromStock ? copy('ลบแล้วรายจ่ายหมวดวัตถุดิบของวันนั้นจะหายไป แต่ของในคลังยังอยู่เท่าเดิม', 'Deleting removes that day’s ingredient expense; the stock itself stays as it is') : copy('ลบแล้วเอากลับไม่ได้ รายจ่ายรวมของวันนั้นจะลดลงตามยอดนี้', 'This cannot be undone; the day’s total drops by this amount')}
              open={confirmDelete}
              onOpen={() => setConfirmDelete(true)}
              onCancel={() => setConfirmDelete(false)}
              onConfirm={remove}
              loading={saving}
            />
          </View>
        ) : null}
        {confirmDelete ? <Button variant="secondary" label={copy('กลับไปแก้ไข', 'Back to editing')} onPress={() => setConfirmDelete(false)} /> : null}
      </View>
      <DayPickerSheet open={pickingDay} onClose={() => setPickingDay(false)} value={spentAt} today={today} onPick={setSpentAt} language={language} />
    </AppScreen>
  );
}
