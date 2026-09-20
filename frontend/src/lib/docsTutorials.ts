import type { LocalizedText } from "./docsContent";

export type DocTutorialItemKind = "field" | "choice" | "card" | "status" | "action" | "summary";

export type DocTutorialTone = "neutral" | "primary" | "ready" | "warning" | "info";

export type DocTutorialItem = {
  number: number;
  kind: DocTutorialItemKind;
  label: LocalizedText;
  value?: LocalizedText;
  detail: LocalizedText;
  tone?: DocTutorialTone;
  span?: "full" | "half";
};

export type DocTutorialPanel = {
  title: LocalizedText;
  items: DocTutorialItem[];
};

export type DocTutorial = {
  articleSlug: string;
  sectionId: string;
  startAt: LocalizedText;
  title: LocalizedText;
  description: LocalizedText;
  result: LocalizedText;
  procedureLabel?: LocalizedText;
  layout: "single" | "split" | "board";
  panels: DocTutorialPanel[];
};

export const DOC_TUTORIALS: DocTutorial[] = [
  {
    articleSlug: "menu",
    sectionId: "organize-menu",
    startAt: { th: "เมนูด้านข้าง → เมนู", en: "Sidebar → Menu" },
    title: {
      th: "เพิ่มเมนูใหม่และเปิดขาย",
      en: "Add a menu item and make it available",
    },
    description: {
      th: "สร้างหมวดก่อนถ้ายังไม่มี จากนั้นกรอกข้อมูลเมนู บันทึก และตรวจสถานะบนการ์ด",
      en: "Create a category if needed, enter the item details, save it, and verify its card status.",
    },
    result: {
      th: "เมนูใหม่แสดงในหมวดที่เลือก และรับออเดอร์ได้เมื่อการ์ดแสดงสถานะ “พร้อมขาย”",
      en: "The item appears in its selected categories and can be ordered when its card shows “Available.”",
    },
    layout: "board",
    panels: [
      {
        title: { th: "หน้าเมนูอาหาร", en: "Menu page" },
        items: [
          {
            number: 1,
            kind: "action",
            label: { th: "หมวดหมู่เมนู", en: "Menu categories" },
            detail: {
              th: "ถ้ายังไม่มีหมวด ให้กดปุ่มนี้ กรอกชื่อหมวดหมู่ แล้วกด “เพิ่มหมวดหมู่” ก่อนกลับมาหน้าเมนู",
              en: "If no category exists, select this, enter a category name, then select “Add category” before returning to the menu.",
            },
            tone: "info",
          },
          {
            number: 2,
            kind: "action",
            label: { th: "เพิ่มเมนู", en: "Add menu item" },
            detail: {
              th: "กดเพื่อเปิดตัวแก้ไขเมนูใหม่ แล้วทำต่อในแท็บ “ข้อมูลหลัก”",
              en: "Select this to open a new item editor, then continue in the “Basic info” tab.",
            },
            tone: "primary",
          },
        ],
      },
      {
        title: { th: "ตัวแก้ไข · ข้อมูลหลัก", en: "Editor · Basic info" },
        items: [
          {
            number: 3,
            kind: "choice",
            label: { th: "หมวดหมู่เมนู · ชื่อเมนู", en: "Menu categories · Menu item name" },
            value: { th: "เลือกอย่างน้อย 1 หมวด", en: "Choose at least 1 category" },
            detail: {
              th: "เลือกอย่างน้อยหนึ่งหมวด แล้วกรอกชื่อที่พนักงานและลูกค้าจำได้ สองส่วนนี้ต้องมีก่อนบันทึก",
              en: "Choose at least one category and enter a recognizable name. Both are required before saving.",
            },
            span: "full",
          },
          {
            number: 4,
            kind: "field",
            label: { th: "ราคาเมนู (บาท)", en: "Price (THB)" },
            value: { th: "รูปเมนูและรายละเอียดใส่เพิ่มได้", en: "Image and description are optional" },
            detail: {
              th: "กรอกราคา แล้วเพิ่มรูปหรือรายละเอียดเมื่อช่วยให้ทีมแยกเมนูได้ง่ายขึ้น",
              en: "Enter the price, then add an image or description when it helps the team identify the item.",
            },
          },
          {
            number: 5,
            kind: "action",
            label: { th: "เพิ่มเมนู", en: "Add menu item" },
            detail: {
              th: "กดปุ่มด้านล่างของตัวแก้ไข รอข้อความ “เพิ่มเมนูแล้ว” แล้วตัวแก้ไขจะปิด",
              en: "Select the action at the bottom of the editor. Wait for “Menu item added,” then the editor closes.",
            },
            tone: "primary",
          },
          {
            number: 6,
            kind: "status",
            label: { th: "พร้อมขาย / ปิดขาย", en: "Available / Unavailable" },
            detail: {
              th: "ตรวจการ์ดที่สร้างแล้ว ใช้สวิตช์เปลี่ยนสถานะได้ทันที หรือกดการ์ดเพื่อแก้แล้วจบด้วย “บันทึกเมนู”",
              en: "Check the new card. Use its switch to change availability, or open the card, edit it, and finish with “Save menu item.”",
            },
            tone: "ready",
            span: "full",
          },
        ],
      },
    ],
  },
  {
    articleSlug: "menu",
    sectionId: "option-groups",
    startAt: { th: "เมนูด้านข้าง → เมนู", en: "Sidebar → Menu" },
    title: {
      th: "เพิ่มชุดตัวเลือกให้เมนู",
      en: "Add an option group to a menu item",
    },
    description: {
      th: "เปิดเมนูเดิม เพิ่มชุดและตัวเลือก ตั้งข้อบังคับ แล้วบันทึกเมนูให้ครบขั้นตอน",
      en: "Open an existing item, add the group and choices, set its rules, then save the menu item.",
    },
    result: {
      th: "เมื่อพนักงานหรือลูกค้าเลือกเมนูนี้ ระบบจะแสดงชุดตัวเลือกและบังคับตามค่าที่บันทึกไว้",
      en: "When staff or guests select this item, Dishy shows the option group and enforces the saved rules.",
    },
    layout: "single",
    panels: [
      {
        title: { th: "ตัวแก้ไขเมนู · ตัวเลือก", en: "Menu editor · Options" },
        items: [
          {
            number: 1,
            kind: "card",
            label: { th: "การ์ดเมนู → ตัวเลือก", en: "Menu card → Options" },
            detail: {
              th: "กดการ์ดเมนูที่ต้องการแก้ แล้วเลือกแท็บ “ตัวเลือก” ด้านบนของตัวแก้ไข",
              en: "Open the menu card you want to edit, then select the “Options” tab at the top of the editor.",
            },
          },
          {
            number: 2,
            kind: "action",
            label: { th: "เพิ่มชุดตัวเลือก", en: "Add option group" },
            detail: {
              th: "กดเพื่อสร้างชุดว่างหนึ่งชุด แล้วกรอก “ชื่อชุดตัวเลือก” เช่น ระดับความสุกหรือขนาด",
              en: "Select this to create one empty group, then enter an “Option group name,” such as doneness or size.",
            },
            tone: "info",
          },
          {
            number: 3,
            kind: "choice",
            label: { th: "ต้องเลือก · เลือกได้สูงสุด", en: "Required · Max choices" },
            value: { th: "สูงสุดอย่างน้อย 1", en: "Maximum must be at least 1" },
            detail: {
              th: "เปิด “ต้องเลือก” เมื่อลูกค้าต้องตอบ และกำหนดจำนวนสูงสุดที่เลือกได้ ระบบไม่มีช่องขั้นต่ำแยก",
              en: "Enable “Required” when a choice is mandatory and set the selection cap. There is no separate minimum field.",
            },
            tone: "warning",
          },
          {
            number: 4,
            kind: "field",
            label: { th: "ชื่อตัวเลือก · ราคาเพิ่ม", en: "Option name · Extra price" },
            value: { th: "ใช้ “เพิ่มตัวเลือก” เมื่อต้องมีหลายค่า", en: "Use “Add option” for more choices" },
            detail: {
              th: "กรอกอย่างน้อยหนึ่งตัวเลือก ราคาเพิ่มเป็น 0 ได้ และกด “เพิ่มตัวเลือก” จนครบรายการที่ขายจริง",
              en: "Enter at least one choice. Extra price may be 0; select “Add option” until every sold choice is listed.",
            },
            span: "full",
          },
          {
            number: 5,
            kind: "action",
            label: { th: "บันทึกเมนู", en: "Save menu item" },
            detail: {
              th: "เลื่อนลงด้านล่างแล้วกดบันทึก หากชื่อชุดหรือชื่อตัวเลือกไม่ครบ ระบบจะแจ้งให้แก้ก่อน",
              en: "Scroll to the bottom and save. Dishy asks you to fix any missing group or option names first.",
            },
            tone: "primary",
            span: "full",
          },
        ],
      },
    ],
  },
  {
    articleSlug: "tables-and-reservations",
    sectionId: "table-layout",
    startAt: { th: "เมนูด้านข้าง → โต๊ะ", en: "Sidebar → Tables" },
    title: {
      th: "สร้างโต๊ะและให้ระบบออกเลขอัตโนมัติ",
      en: "Create tables with automatic numbering",
    },
    description: {
      th: "ตั้งโซนถ้าต้องใช้ จากนั้นระบุจำนวนโต๊ะและที่นั่งก่อนยืนยันสร้าง",
      en: "Set up zones if needed, then enter the table count and seats before creating them.",
    },
    result: {
      th: "โต๊ะใหม่แสดงในโซนที่เลือกพร้อมเลขที่ระบบสร้าง และพร้อมนำไปเปิดออเดอร์เมื่อสถานะเป็น “ว่าง”",
      en: "The tables appear in the selected zone with generated numbers and can start orders while their status is “Free.”",
    },
    layout: "split",
    panels: [
      {
        title: { th: "ตั้งค่าโครงสร้างร้าน", en: "Set up restaurant structure" },
        items: [
          {
            number: 1,
            kind: "action",
            label: { th: "จัดการโซน", en: "Manage zones" },
            value: { th: "ชื่อโซน · ตัวอักษรนำหน้าเลขโต๊ะ", en: "Zone name · Table number letters" },
            detail: {
              th: "ถ้าต้องแบ่งพื้นที่ ให้กรอกชื่อโซนและตัวอักษรนำหน้า (ไม่บังคับ) แล้วกด “เพิ่มโซน” ใช้ปุ่มเลื่อนขึ้นหรือลงเพื่อจัดลำดับ",
              en: "If the restaurant has separate areas, enter a zone name and optional table letters, then select “Add zone.” Use Move up or Move down to reorder it.",
            },
            tone: "info",
          },
          {
            number: 2,
            kind: "action",
            label: { th: "เพิ่มโต๊ะ", en: "Add table" },
            detail: {
              th: "กดปุ่มนี้เพื่อเปิด “ตั้งค่าโต๊ะ” ซึ่งสร้างได้ทั้งโต๊ะเดียวและหลายโต๊ะในครั้งเดียว",
              en: "Select this to open “Table settings,” which supports one table or a batch in the same flow.",
            },
            tone: "primary",
          },
        ],
      },
      {
        title: { th: "ตั้งค่าโต๊ะ", en: "Table settings" },
        items: [
          {
            number: 3,
            kind: "field",
            label: { th: "โซน · จำนวนโต๊ะ · จำนวนที่นั่ง", en: "Zone · Table count · Seats" },
            value: { th: "ตรวจตัวอย่างเลขก่อนสร้าง", en: "Check the number preview" },
            detail: {
              th: "เลือกโซน กรอกจำนวนโต๊ะและที่นั่ง ระบบออกเลขให้เองและแสดงที่ “ตัวอย่างเลข”",
              en: "Choose a zone and enter the table count and seats. Dishy generates the numbers and shows them under “Number preview.”",
            },
            span: "full",
          },
          {
            number: 4,
            kind: "action",
            label: { th: "เพิ่มโต๊ะ / บันทึกโต๊ะ", en: "Add table / Save table" },
            detail: {
              th: "กด “เพิ่มโต๊ะ” เพื่อสร้าง ภายหลังกดการ์ดเพื่อแก้แล้วใช้ “บันทึกโต๊ะ” สถานะ “ใช้งาน” และ “จอง” เปลี่ยนจากออเดอร์หรือการจองเท่านั้น",
              en: "Select “Add table” to create. Later, open a card and use “Save table” to edit it. “Occupied” and “Reserved” change only through orders or reservations.",
            },
            tone: "primary",
            span: "full",
          },
        ],
      },
    ],
  },
  {
    articleSlug: "team-and-permissions",
    sectionId: "invite-staff",
    startAt: { th: "เมนูด้านข้าง → พนักงาน", en: "Sidebar → Staff" },
    title: {
      th: "สร้างและส่งลิงก์เชิญพนักงาน",
      en: "Create and send a staff invitation link",
    },
    description: {
      th: "เลือกว่าลิงก์ผูกกับอีเมลใดหรือเปิดให้ทุกบัญชี เลือกบทบาทและวันหมดอายุ แล้วส่งให้ผู้รับเข้าร่วมร้าน",
      en: "Choose whether the link is email-bound or open to any account, set the role and expiry, then send it to the recipient.",
    },
    result: {
      th: "คำเชิญแสดงในรายการรอรับ ผู้รับที่ตรงเงื่อนไขสามารถเข้าสู่ระบบ กดรับคำเชิญ และเข้าร่วมร้านด้วยบทบาทที่เลือก",
      en: "The invitation appears under Pending invitations. An eligible recipient can sign in, accept it, and join with the selected role.",
    },
    layout: "split",
    panels: [
      {
        title: { th: "หน้าพนักงาน", en: "Staff page" },
        items: [
          {
            number: 1,
            kind: "action",
            label: { th: "สร้างลิงก์เชิญ", en: "Create invitation link" },
            detail: {
              th: "กดเพื่อเปิดแบบฟอร์มเชิญพนักงาน แล้วตั้งค่าลิงก์ก่อนส่งให้ผู้รับ",
              en: "Select this to open the staff invitation form, then configure the link before sending it.",
            },
            tone: "primary",
          },
          {
            number: 2,
            kind: "field",
            label: { th: "อีเมลพนักงาน", en: "Staff email" },
            value: { th: "ไม่บังคับ", en: "Optional" },
            detail: {
              th: "เว้นว่างเพื่อให้บัญชีใดก็ได้ใช้ลิงก์ หรือกรอกอีเมลเพื่อให้เฉพาะบัญชีอีเมลเดียวกันรับคำเชิญได้",
              en: "Leave it blank so any account can use the link, or enter an email so only an account with that email can accept it.",
            },
            tone: "warning",
          },
          {
            number: 3,
            kind: "choice",
            label: { th: "บทบาท · วันหมดอายุ", en: "Role · Expiry" },
            detail: {
              th: "เลือกบทบาทที่ต้องการและกำหนดวันหมดอายุหรือ “ไม่หมดอายุ” ตัวเลือกบทบาทขึ้นกับสิทธิ์ของผู้เชิญ",
              en: "Choose the intended role and an expiry or “No expiry.” Available roles depend on the inviter's permissions.",
            },
          },
          {
            number: 4,
            kind: "action",
            label: { th: "สร้างลิงก์เชิญ", en: "Create invitation link" },
            detail: {
              th: "กดในแบบฟอร์ม ระบบสร้างคำเชิญและพยายามคัดลอกลิงก์ให้ทันที จากนั้นปิดแบบฟอร์มได้",
              en: "Select this in the form. Dishy creates the invitation and attempts to copy the link immediately; you can then close the form.",
            },
            tone: "primary",
          },
        ],
      },
      {
        title: { th: "คำเชิญที่รอรับ", en: "Pending invitations" },
        items: [
          {
            number: 5,
            kind: "action",
            label: { th: "คัดลอก · ส่งอีเมล · ยกเลิก", en: "Copy · Send email · Revoke" },
            value: { th: "ผู้รับกด “รับคำเชิญและเข้าร่วมร้าน”", en: "Recipient selects “Accept invitation and join”" },
            detail: {
              th: "ตรวจบทบาทและวันหมดอายุแล้วเลือกวิธีส่ง ผู้รับเข้าสู่ระบบและกดรับคำเชิญ หากกด “ยกเลิก” ลิงก์จะใช้ไม่ได้ทันที",
              en: "Check the role and expiry, then choose how to send it. The recipient signs in and accepts. Selecting “Revoke” invalidates the link immediately.",
            },
            tone: "info",
            span: "full",
          },
        ],
      },
    ],
  },
  {
    articleSlug: "inventory",
    sectionId: "stock-movements",
    startAt: { th: "เมนูด้านข้าง → คลังวัตถุดิบ", en: "Sidebar → Inventory" },
    title: {
      th: "ปรับยอดวัตถุดิบและตรวจประวัติ",
      en: "Adjust an ingredient balance and check its history",
    },
    description: {
      th: "เริ่มจากวัตถุดิบที่ต้องการ เลือกประเภทการปรับ กรอกจำนวน ตรวจยอดใหม่ แล้วบันทึก",
      en: "Start from the intended ingredient, choose the movement type, enter a quantity, review the new balance, and save.",
    },
    result: {
      th: "ยอดคงเหลือเปลี่ยนตามรายการที่บันทึก และตรวจย้อนหลังได้จาก “ประวัติ” ของวัตถุดิบนั้น",
      en: "The balance changes according to the saved movement and remains available under that ingredient's “History.”",
    },
    layout: "split",
    panels: [
      {
        title: { th: "รายการวัตถุดิบ", en: "Ingredient list" },
        items: [
          {
            number: 1,
            kind: "action",
            label: { th: "ปรับสต็อก", en: "Adjust" },
            detail: {
              th: "กดที่แถวของวัตถุดิบเป้าหมาย เพื่อให้รายการเคลื่อนไหวผูกกับวัตถุดิบถูกตัว",
              en: "Select this on the intended ingredient row so the movement is recorded against the correct item.",
            },
            tone: "primary",
          },
        ],
      },
      {
        title: { th: "หน้าต่างปรับสต็อก", en: "Stock adjustment" },
        items: [
          {
            number: 2,
            kind: "choice",
            label: { th: "รับเข้า · จ่ายออก · ตั้งค่าใหม่", en: "Stock in · Stock out · Set value" },
            detail: {
              th: "เลือกให้ตรงกับงาน: รับเข้าเพิ่มยอด จ่ายออกลดยอด และตั้งค่าใหม่แทนยอดคงเหลือเดิม",
              en: "Choose the actual movement: Stock in adds, Stock out subtracts, and Set value replaces the current balance.",
            },
          },
          {
            number: 3,
            kind: "field",
            label: { th: "จำนวน · หมายเหตุ", en: "Quantity · Note" },
            detail: {
              th: "กรอกจำนวนมากกว่า 0 หมายเหตุไม่บังคับแต่ควรใส่เหตุผลที่ทีมเข้าใจ และยอดจ่ายออกต้องไม่เกินยอดคงเหลือ",
              en: "Enter a quantity above 0. A note is optional but should explain the reason; Stock out cannot exceed the current balance.",
            },
          },
          {
            number: 4,
            kind: "field",
            label: { th: "ยอดที่จ่ายจริง (ไม่บังคับ)", en: "Actual amount paid (optional)" },
            value: { th: "แสดงเฉพาะการรับเข้า", en: "Stock in only" },
            detail: {
              th: "ผู้มีสิทธิ์รายจ่ายกรอกยอดที่จ่ายจริงได้ หากเว้นว่างหรือไม่เห็นช่อง ระบบใช้ต้นทุนต่อหน่วยคูณจำนวน และบันทึกรายจ่ายที่เชื่อมกันเมื่อยอดที่ได้มากกว่า 0",
              en: "Users with expense permission can enter the actual amount. If it is blank or the field is hidden, Dishy uses unit cost × quantity and records a linked expense when the resulting amount is above 0.",
            },
            tone: "warning",
            span: "full",
          },
          {
            number: 5,
            kind: "summary",
            label: { th: "หลังบันทึก → บันทึก", en: "After saving → Save" },
            detail: {
              th: "ตรวจยอดตัวอย่างแล้วกด “บันทึก” หากเลือกจ่ายออกหรือตั้งค่าใหม่ ให้กด “ยืนยันปรับสต็อก” ในหน้าต่างยืนยันอีกครั้ง",
              en: "Check the preview, then select “Save.” For Stock out or Set value, select “Confirm adjustment” in the confirmation dialog.",
            },
            tone: "info",
            span: "full",
          },
          {
            number: 6,
            kind: "action",
            label: { th: "ประวัติ", en: "History" },
            detail: {
              th: "หลังบันทึก กลับไปที่วัตถุดิบเดิมแล้วกด “ประวัติ” เพื่อตรวจประเภท จำนวน หมายเหตุ และเวลาของรายการ",
              en: "After saving, return to the same ingredient and select “History” to verify the type, quantity, note, and time.",
            },
            span: "full",
          },
        ],
      },
    ],
  },
  {
    articleSlug: "take-orders",
    sectionId: "open-order",
    startAt: { th: "เมนูด้านข้าง → รับออเดอร์", en: "Sidebar → Take orders" },
    title: {
      th: "เริ่มออเดอร์จากโต๊ะที่ถูกต้อง",
      en: "Start an order from the correct table",
    },
    description: {
      th: "เส้นทางหลักคือเปิดโต๊ะว่าง หากเป็นกลับบ้านให้ใช้ทางเลือกในข้อ 3 แล้วข้ามข้อ 4-5",
      en: "The main path opens a free table. For takeaway, use the option in step 3 and skip steps 4–5.",
    },
    result: {
      th: "ระบบเปิดหน้าเลือกรายการของออเดอร์ใหม่ หรือพากลับไปยังออเดอร์เดิมของโต๊ะที่กำลังใช้งาน",
      en: "Dishy opens the new order-taking screen or returns to the existing order for an active table.",
    },
    procedureLabel: {
      th: "เลือกเส้นทาง แล้วทำเฉพาะขั้นตอนที่เกี่ยวข้อง",
      en: "Choose a path, then follow only its steps",
    },
    layout: "split",
    panels: [
      {
        title: { th: "หน้าเลือกโต๊ะ", en: "Table picker" },
        items: [
          {
            number: 1,
            kind: "field",
            label: { th: "ค้นหาโต๊ะ", en: "Search tables" },
            detail: {
              th: "ค้นหาจากเลขโต๊ะหรือโซนก่อนเลือก โดยเฉพาะร้านที่มีหลายพื้นที่",
              en: "Search by table or zone before selecting, especially in multi-zone restaurants.",
            },
          },
          {
            number: 2,
            kind: "card",
            label: { th: "สถานะบนการ์ดโต๊ะ", en: "Table-card status" },
            value: { th: "ว่าง · ใช้งาน · จอง · ปิดใช้งาน", en: "Free · Active order · Reserved · Inactive" },
            detail: {
              th: "แตะโต๊ะว่างเพื่อเริ่มออเดอร์ หรือแตะโต๊ะที่ใช้งานเพื่อกลับไปทำออเดอร์เดิมต่อ",
              en: "Tap a free table to start, or an active table to continue its existing order.",
            },
            span: "full",
          },
          {
            number: 3,
            kind: "action",
            label: { th: "ถ้าเป็นกลับบ้าน: สั่งกลับบ้าน", en: "For takeaway: Takeaway" },
            detail: {
              th: "ใช้เมื่อลูกค้าไม่ได้นั่งโต๊ะ ชื่อและเบอร์ลูกค้าใส่หรือเว้นว่างได้ เมื่อสร้างแล้วให้ข้ามข้อ 4-5",
              en: "Use this when the guest is not seated; name and phone are optional. After creating it, skip steps 4–5.",
            },
            tone: "info",
          },
        ],
      },
      {
        title: { th: "เปิดโต๊ะ", en: "Open table" },
        items: [
          {
            number: 4,
            kind: "field",
            label: { th: "จำนวนลูกค้าและหมายเหตุ", en: "Guest count and note" },
            detail: {
              th: "ปรับจำนวนลูกค้าให้ตรงกับโต๊ะ และใส่เฉพาะหมายเหตุที่ทีมต้องรู้ก่อนรับรายการ",
              en: "Set the guest count for the table and add only notes the team needs before ordering.",
            },
          },
          {
            number: 5,
            kind: "action",
            label: { th: "เปิดโต๊ะ", en: "Open table" },
            detail: {
              th: "ยืนยันแล้วระบบจะสร้างออเดอร์และพาไปหน้าเลือกเมนูของโต๊ะนี้",
              en: "Confirmation creates the order and opens this table's menu-taking screen.",
            },
            tone: "primary",
          },
        ],
      },
    ],
  },
  {
    articleSlug: "take-orders",
    sectionId: "build-round",
    startAt: {
      th: "รับออเดอร์ → เลือกโต๊ะ → เปิดโต๊ะหรือทำออเดอร์ต่อ",
      en: "Take orders → choose a table → open or continue its order",
    },
    title: {
      th: "เพิ่มเมนูและส่งรายการรอบนี้เข้าครัว",
      en: "Add menu items and send the current round",
    },
    description: {
      th: "เลือกเมนู ตั้งค่ารายการ กด “เพิ่ม” แล้วตรวจ “รายการรอบนี้” ก่อนกด “ส่งเข้าครัว”",
      en: "Choose a menu item, configure it, select “Add,” review “Current round,” then select “Send to Kitchen.”",
    },
    result: {
      th: "รายการรอบนี้แสดงบนจอครัว ส่วนรายการที่เพิ่มหลังจากส่งแล้วจะอยู่ในรอบใหม่",
      en: "The current round appears on the kitchen display. Items added afterward stay in a new round.",
    },
    layout: "board",
    panels: [
      {
        title: { th: "เลือกเมนู", en: "Choose menu items" },
        items: [
          {
            number: 1,
            kind: "choice",
            label: { th: "ค้นหาเมนู / ทั้งหมด", en: "Search menu / All" },
            detail: {
              th: "ใช้ช่อง “ค้นหาเมนู” หรือเลือกหมวดจากตัวเลือกที่เริ่มที่ “ทั้งหมด” เพื่อหารายการ",
              en: "Use “Search menu” or choose a category from the selector that starts at “All.”",
            },
          },
          {
            number: 2,
            kind: "card",
            label: { th: "แตะการ์ดเมนู", en: "Select a menu card" },
            detail: {
              th: "เลือกรายการที่ต้องการเพื่อเปิดหน้าตั้งค่า รายการที่ขึ้น “หมด” เปิดเพิ่มไม่ได้",
              en: "Choose the item to open its setup. A card marked “Sold out” cannot be added.",
            },
          },
        ],
      },
      {
        title: { th: "ตั้งค่ารายการ", en: "Configure item" },
        items: [
          {
            number: 3,
            kind: "choice",
            label: { th: "ต้องเลือก", en: "Required" },
            detail: {
              th: "ในชุดที่มีป้าย “ต้องเลือก” ให้เลือกอย่างน้อยตามขั้นต่ำ โดยไม่เกินจำนวนสูงสุดที่แสดง",
              en: "For groups marked “Required,” meet the minimum without exceeding the displayed maximum.",
            },
            tone: "warning",
          },
          {
            number: 4,
            kind: "field",
            label: { th: "จำนวน · รูปแบบรายการ · หมายเหตุ → เพิ่ม", en: "Qty · Item type · Note → Add" },
            value: { th: "ทานที่ร้าน / กลับบ้าน", en: "Dine-in / Takeaway" },
            detail: {
              th: "ตั้งจำนวน เลือก “ทานที่ร้าน” หรือ “กลับบ้าน” ใส่หมายเหตุถ้าจำเป็น แล้วกด “เพิ่ม”",
              en: "Set Qty, choose “Dine-in” or “Takeaway,” add a Note if needed, then select “Add.”",
            },
            span: "full",
          },
        ],
      },
      {
        title: { th: "รายการรอบนี้", en: "Current round" },
        items: [
          {
            number: 5,
            kind: "action",
            label: { th: "ตะกร้า · … รายการ", en: "Cart · … Items" },
            detail: {
              th: "แตะแถบด้านล่างเพื่อเปิด “รายการรอบนี้” แล้วตรวจเมนู จำนวน และยอด รายการที่รอส่งยังปรับจำนวนหรือลบได้",
              en: "Select the bottom bar to open “Current round.” Review items, quantities, and total; pending items can still be changed or removed.",
            },
            tone: "info",
            span: "full",
          },
          {
            number: 6,
            kind: "action",
            label: { th: "ส่งเข้าครัว", en: "Send to Kitchen" },
            detail: {
              th: "เมื่อรายการถูกต้องให้กดปุ่มนี้ รายการที่เพิ่มหลังจากนี้จะเริ่มเป็นรอบใหม่",
              en: "When the round is correct, select this action. Items added afterward form a new round.",
            },
            tone: "primary",
            span: "full",
          },
        ],
      },
    ],
  },
  {
    articleSlug: "kitchen",
    sectionId: "update-kitchen-status",
    startAt: { th: "เมนูด้านข้าง → จอครัว", en: "Sidebar → Kitchen display" },
    title: {
      th: "อัปเดตรายการในจอครัว",
      en: "Update items on the kitchen display",
    },
    description: {
      th: "อ่านใบงานใน “โซนกำลังทำ” แล้วเลือกเฉพาะการทำงานที่ตรงกับสถานการณ์จริง",
      en: "Read each ticket in “Cooking,” then use only the action that matches the current situation.",
    },
    result: {
      th: "รายการที่กด “เสร็จแล้ว” ย้ายไปโซนเสร็จแล้วและแจ้งหน้าร้านว่าพร้อมส่งมอบ",
      en: "An item marked “Done” moves to the Done zone and becomes ready for front-of-house handoff.",
    },
    procedureLabel: {
      th: "หลังอ่านใบงาน เลือกเฉพาะการทำงานที่ตรงกับสถานการณ์",
      en: "Read the ticket, then use only the action that matches",
    },
    layout: "board",
    panels: [
      {
        title: { th: "โซนกำลังทำ", en: "Cooking" },
        items: [
          {
            number: 1,
            kind: "choice",
            label: { th: "โซนกำลังทำ / โซนเสร็จแล้ว", en: "Cooking / Done" },
            detail: {
              th: "งานใหม่อยู่ใน “โซนกำลังทำ” ส่วนรายการที่ครัวทำเสร็จแล้วอยู่ใน “โซนเสร็จแล้ว”",
              en: "New work appears in “Cooking”; completed work appears in “Done.”",
            },
          },
          {
            number: 2,
            kind: "card",
            label: { th: "อ่านใบงาน", en: "Read the ticket" },
            value: { th: "โต๊ะ/กลับบ้าน · รอบ · ออเดอร์ · เวลา", en: "Table/takeaway · Batch · Order · Time" },
            detail: {
              th: "ตรวจโต๊ะหรือกลับบ้าน รอบ เลขออเดอร์ เวลาที่รอ จำนวน ชื่อเมนู ตัวเลือก และหมายเหตุก่อนเปลี่ยนสถานะ",
              en: "Check table/takeaway, batch, order number, elapsed time, quantity, item, options, and note before changing status.",
            },
            span: "full",
          },
          {
            number: 3,
            kind: "action",
            label: { th: "รายการเดียวเสร็จ: เสร็จแล้ว", en: "One item ready: Done" },
            detail: {
              th: "กดไอคอนเครื่องหมายถูกที่มีชื่อ “เสร็จแล้ว” เฉพาะรายการที่พร้อมส่งหน้าร้าน",
              en: "Select the check action named “Done” only when that item is ready for handoff.",
            },
            tone: "ready",
          },
          {
            number: 4,
            kind: "action",
            label: { th: "ทั้งใบงานเสร็จ: เสร็จทั้งหมด", en: "Whole ticket ready: Mark all done" },
            detail: {
              th: "ใช้เมื่อทุกรายการที่กำลังทำในใบงานเดียวกันเสร็จพร้อมกัน ปุ่มนี้แสดงเมื่อมีมากกว่าหนึ่งรายการและผู้ใช้มีสิทธิ์อัปเดต",
              en: "Use only when every cooking item on one ticket is ready. This appears for tickets with more than one item and update permission.",
            },
            tone: "primary",
          },
        ],
      },
      {
        title: { th: "โซนเสร็จแล้วและการแก้ไข", en: "Done and corrections" },
        items: [
          {
            number: 5,
            kind: "status",
            label: { th: "กดเสร็จผิด: ย้ายไปกำลังทำ", en: "Marked done by mistake: Undo" },
            detail: {
              th: "ที่รายการในโซนเสร็จแล้ว กดไอคอนย้อนกลับ แล้วกด “ยืนยัน” เมื่อกดเสร็จผิดหรืออาหารยังต้องแก้",
              en: "On an item in Done, select “Undo,” then “Confirm” when completion was accidental or more work is needed.",
            },
            tone: "info",
          },
          {
            number: 6,
            kind: "action",
            label: { th: "ทำต่อไม่ได้: ยกเลิก", en: "Cannot fulfill: Cancel" },
            value: { th: "เหตุผลที่ยกเลิก → ยืนยันยกเลิก", en: "Cancellation reason → Confirm cancellation" },
            detail: {
              th: "กดที่รายการกำลังทำ เลือกหรือกรอกเหตุผล แล้วกด “ยืนยันยกเลิก” ผู้มีสิทธิ์ดูอย่างเดียวจะไม่เห็นปุ่มเปลี่ยนสถานะ",
              en: "On a cooking item, select Cancel, choose or enter a reason, then select “Confirm cancellation.” View-only users do not see status actions.",
            },
            tone: "warning",
          },
        ],
      },
    ],
  },
  {
    articleSlug: "billing-and-payments",
    sectionId: "payment-methods",
    startAt: {
      th: "รับออเดอร์ → เปิดออเดอร์ที่ใช้งาน → ออกบิล / รับเงิน",
      en: "Take orders → open an active order → Bill / Pay",
    },
    title: {
      th: "รับเงินสดหรือ QR PromptPay",
      en: "Take cash or PromptPay payment",
    },
    description: {
      th: "เปิด “ออกบิล / รับเงิน” ตรวจรายการ เลือกเงินสดหรือ QR เพียงวิธีเดียว แล้วกดยืนยันหลังตรวจว่ารับเงินจริง",
      en: "Open “Bill / Pay,” review the items, choose either Cash or QR, then confirm only after verifying payment.",
    },
    result: {
      th: "ระบบบันทึกการชำระ ปิดออเดอร์ กลับไปหน้าเลือกโต๊ะ และคืนโต๊ะเป็นว่างเมื่อไม่มีออเดอร์อื่นค้างอยู่",
      en: "Dishy records payment, closes the order, returns to the table picker, and frees the table when no other order remains open.",
    },
    procedureLabel: {
      th: "ทำข้อ 1-3 เลือกข้อ 4 หรือ 5 แล้วจบที่ข้อ 6",
      en: "Complete 1–3, choose 4 or 5, then finish at 6",
    },
    layout: "split",
    panels: [
      {
        title: { th: "เปิดและตรวจบิล", en: "Open and review the bill" },
        items: [
          {
            number: 1,
            kind: "action",
            label: { th: "ออกบิล / รับเงิน", en: "Bill / Pay" },
            detail: {
              th: "ปุ่มแสดงเมื่อออเดอร์มีรายการอย่างน้อยหนึ่งรายการและไม่มีรายการรอส่งครัว หากยังมีรายการกำลังทำ บิลจะเตือนและยังยืนยันรับเงินไม่ได้",
              en: "This appears when the order has at least one active item and none is pending kitchen submission. If items are still cooking, the bill warns you and payment confirmation remains disabled.",
            },
            tone: "primary",
          },
          {
            number: 2,
            kind: "summary",
            label: { th: "รายการทั้งหมดและยอด", en: "Items and totals" },
            value: { th: "ยอดรวม · Service charge · VAT · ยอดสุทธิ", en: "Total · Service charge · VAT · Grand total" },
            detail: {
              th: "ตรวจชื่อ จำนวน ราคา ยอดรวม ค่าบริการ VAT และยอดสุทธิให้ตรงกับรายการที่จะรับเงินจริง",
              en: "Check names, quantities, prices, Total, service charge, VAT, and Grand total against what will actually be paid.",
            },
            tone: "neutral",
          },
        ],
      },
      {
        title: { th: "เลือกวิธีและยืนยัน", en: "Choose a method and confirm" },
        items: [
          {
            number: 3,
            kind: "choice",
            label: { th: "วิธีรับเงิน", en: "Payment method" },
            value: { th: "เงินสด / QR PromptPay", en: "Cash / QR PromptPay" },
            detail: {
              th: "เลือกให้ตรงกับวิธีที่ลูกค้าจ่ายจริง เพื่อให้ประวัติการชำระเงินถูกต้อง",
              en: "Choose the method the guest actually used so payment history stays accurate.",
            },
          },
          {
            number: 4,
            kind: "summary",
            label: { th: "ถ้าเลือกเงินสด", en: "If you chose Cash" },
            detail: {
              th: "หน้าปัจจุบันไม่มีช่องเงินรับหรือเงินทอน ระบบบันทึกยอดรับเท่ากับ “ยอดสุทธิ”",
              en: "The current screen has no received-cash or change field. It records the received amount as the Grand total.",
            },
          },
          {
            number: 5,
            kind: "card",
            label: { th: "ถ้าเลือก QR PromptPay", en: "If you chose QR PromptPay" },
            value: { th: "QR คงที่และชื่อบัญชีจากข้อมูลร้าน", en: "Static QR and account name from restaurant settings" },
            detail: {
              th: "ให้พนักงานตรวจยอดโอนเอง Dishy ยังไม่เชื่อม payment gateway และไม่ยืนยันการโอนอัตโนมัติ",
              en: "Staff must verify the transfer. Dishy is not connected to a payment gateway and does not confirm it automatically.",
            },
            tone: "warning",
            span: "full",
          },
          {
            number: 6,
            kind: "action",
            label: { th: "ยืนยันรับเงิน", en: "Confirm payment" },
            detail: {
              th: "กดหลังตรวจว่ารับเงินจริงแล้ว ระบบจะบันทึกการชำระและกลับไปหน้าเลือกโต๊ะ ใบเสร็จพิมพ์ซ้ำได้จากคลังออเดอร์",
              en: "Select this only after verifying payment. Dishy records it and returns to the table picker; receipts can be reprinted from the order archive.",
            },
            tone: "primary",
            span: "full",
          },
        ],
      },
    ],
  },
];

export function docTutorialFor(articleSlug: string, sectionId: string) {
  return DOC_TUTORIALS.find(
    (tutorial) => tutorial.articleSlug === articleSlug && tutorial.sectionId === sectionId,
  );
}
