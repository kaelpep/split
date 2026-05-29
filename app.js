const DEFAULT_FRIENDS = ["sam", "hunter", "amanda", "mick", "rod"];

const config = window.TRIP_SPLITTER_CONFIG || {};
const supabaseUrl = config.supabaseUrl || "";
const supabaseAnonKey = config.supabaseAnonKey || "";
const defaultTripId = config.defaultTripId || "";

const supabaseReady =
  supabaseUrl.startsWith("https://") &&
  supabaseAnonKey.length > 20 &&
  !supabaseUrl.includes("PASTE_") &&
  !supabaseAnonKey.includes("PASTE_");

const hasDefaultTrip = defaultTripId.length > 20 && !defaultTripId.includes("PASTE_");

const db = supabaseReady ? supabase.createClient(supabaseUrl, supabaseAnonKey) : null;

let currentTripId = null;
let currentTripName = "split";
let members = [];
let expenses = [];
let splits = [];
let selectedPayerId = null;
let channels = [];

const el = id => document.getElementById(id);

function money(value) {
  return Number(value || 0).toLocaleString(undefined, {
    style: "currency",
    currency: "USD"
  });
}

function toast(message) {
  const toastEl = el("toast");
  if (!toastEl) return;

  toastEl.textContent = String(message).toLowerCase();
  toastEl.classList.add("show");

  setTimeout(() => {
    toastEl.classList.remove("show");
  }, 1900);
}

function safe(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requireSupabase() {
  if (!supabaseReady) {
    toast("check config.js.");
    return false;
  }

  return true;
}

function requireTrip() {
  if (!requireSupabase()) return false;

  if (!currentTripId) {
    toast("default trip not loaded.");
    return false;
  }

  return true;
}

async function loadDefaultTrip() {
  if (!requireSupabase()) return;

  if (!hasDefaultTrip) {
    toast("add default trip id in config.js.");
    render();
    return;
  }

  const { data, error } = await db
    .from("trips")
    .select("*")
    .eq("id", defaultTripId)
    .single();

  if (error || !data) {
    toast("default trip not found in supabase.");
    render();
    return;
  }

  currentTripId = data.id;
  currentTripName = data.name || "split";

  subscribeToTrip();
  await refreshData();
}

async function createDefaultFriendsIfMissing() {
  if (!currentTripId) return;

  const existingNames = members.map(member => member.name.toLowerCase());
  const missingNames = DEFAULT_FRIENDS.filter(name => !existingNames.includes(name));

  if (!missingNames.length) return;

  const rows = missingNames.map(name => ({
    trip_id: currentTripId,
    name
  }));

  const { error } = await db
    .from("trip_members")
    .insert(rows);

  if (error) {
    toast(error.message);
  }
}

async function refreshData() {
  if (!requireTrip()) return;

  const [membersResult, expensesResult, splitsResult] = await Promise.all([
    db.from("trip_members").select("*").eq("trip_id", currentTripId).order("created_at"),
    db.from("expenses").select("*").eq("trip_id", currentTripId).order("created_at", { ascending: false }),
    db.from("expense_splits").select("*").eq("trip_id", currentTripId)
  ]);

  if (membersResult.error) return toast(membersResult.error.message);
  if (expensesResult.error) return toast(expensesResult.error.message);
  if (splitsResult.error) return toast(splitsResult.error.message);

  members = membersResult.data || [];
  expenses = expensesResult.data || [];
  splits = splitsResult.data || [];

  await createDefaultFriendsIfMissing();

  if (members.length < DEFAULT_FRIENDS.length) {
    const retryMembers = await db
      .from("trip_members")
      .select("*")
      .eq("trip_id", currentTripId)
      .order("created_at");

    if (!retryMembers.error) {
      members = retryMembers.data || members;
    }
  }

  if (!selectedPayerId || !members.some(member => member.id === selectedPayerId)) {
    selectedPayerId = members[0]?.id || null;
  }

  render();
}

function subscribeToTrip() {
  if (!db || !currentTripId) return;

  channels.forEach(channel => db.removeChannel(channel));
  channels = [];

  ["trip_members", "expenses", "expense_splits"].forEach(table => {
    const channel = db
      .channel(`${table}-${currentTripId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `trip_id=eq.${currentTripId}` },
        () => refreshData()
      )
      .subscribe();

    channels.push(channel);
  });
}

function selectPayer(memberId) {
  selectedPayerId = memberId;
  render();
}

function selectAllSplit() {
  document.querySelectorAll("#split-between input[type='checkbox']").forEach(box => {
    box.checked = true;
  });
}

function clearSplit() {
  document.querySelectorAll("#split-between input[type='checkbox']").forEach(box => {
    box.checked = false;
  });
}

async function uploadReceipt(file) {
  if (!file) return null;

  const cleanName = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  const path = `${currentTripId}/${crypto.randomUUID()}-${cleanName}`;

  const { error } = await db
    .storage
    .from("receipts")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false
    });

  if (error) {
    toast(`receipt upload skipped: ${error.message}`);
    return null;
  }

  const { data } = db
    .storage
    .from("receipts")
    .getPublicUrl(path);

  return data?.publicUrl || null;
}

async function addPurchase() {
  if (!requireTrip()) return;

  const description = el("description").value.trim().toLowerCase();
  const amount = Number(el("amount").value);
  const file = el("receipt").files?.[0] || null;
  const splitMemberIds = [...document.querySelectorAll("#split-between input[type='checkbox']:checked")]
    .map(box => box.value);

  if (!selectedPayerId) return toast("choose who paid.");
  if (!description) return toast("add what it was.");
  if (!amount || amount <= 0) return toast("add a valid amount.");
  if (splitMemberIds.length === 0) return toast("choose who split it.");

  const receiptUrl = await uploadReceipt(file);

  const { data: expense, error: expenseError } = await db
    .from("expenses")
    .insert({
      trip_id: currentTripId,
      description,
      amount: Math.round(amount * 100) / 100,
      payer_member_id: selectedPayerId,
      receipt_url: receiptUrl
    })
    .select()
    .single();

  if (expenseError) return toast(expenseError.message);

  const splitRows = splitMemberIds.map(memberId => ({
    trip_id: currentTripId,
    expense_id: expense.id,
    member_id: memberId
  }));

  const { error: splitError } = await db
    .from("expense_splits")
    .insert(splitRows);

  if (splitError) return toast(splitError.message);

  el("description").value = "";
  el("amount").value = "";
  el("receipt").value = "";

  await refreshData();
  selectAllSplit();
}

async function deletePurchase(expenseId) {
  if (!requireTrip()) return;
  if (!confirm("delete this purchase?")) return;

  const { error } = await db
    .from("expenses")
    .delete()
    .eq("id", expenseId);

  if (error) return toast(error.message);

  await refreshData();
}

function calculateBalances() {
  const balances = {};

  members.forEach(member => {
    balances[member.id] = 0;
  });

  expenses.forEach(expense => {
    const expenseSplits = splits.filter(split => split.expense_id === expense.id);
    if (!expenseSplits.length) return;

    balances[expense.payer_member_id] += Number(expense.amount);

    const share = Number(expense.amount) / expenseSplits.length;

    expenseSplits.forEach(split => {
      balances[split.member_id] -= share;
    });
  });

  Object.keys(balances).forEach(id => {
    balances[id] = Math.round(balances[id] * 100) / 100;
  });

  return balances;
}

function calculateSettlements() {
  const balances = calculateBalances();

  const debtors = Object.entries(balances)
    .filter(([, amount]) => amount < -0.005)
    .map(([id, amount]) => ({ id, amount: Math.abs(amount) }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = Object.entries(balances)
    .filter(([, amount]) => amount > 0.005)
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const payment = Math.min(debtors[i].amount, creditors[j].amount);

    settlements.push({
      fromId: debtors[i].id,
      toId: creditors[j].id,
      amount: Math.round(payment * 100) / 100
    });

    debtors[i].amount -= payment;
    creditors[j].amount -= payment;

    if (debtors[i].amount < 0.005) i++;
    if (creditors[j].amount < 0.005) j++;
  }

  return settlements;
}

function memberName(memberId) {
  return members.find(member => member.id === memberId)?.name || "unknown";
}

function render() {
  const needsConfig = !supabaseReady || !hasDefaultTrip;

  const configWarningEl = el("config-warning");
  if (configWarningEl) {
    configWarningEl.classList.toggle("hidden", !needsConfig);
  }

  const purchaserButtonsEl = el("purchaser-buttons");
  if (purchaserButtonsEl) {
    purchaserButtonsEl.innerHTML = members.length
      ? members.map(member => `
        <button class="person ${member.id === selectedPayerId ? "active" : ""}" onclick="selectPayer('${member.id}')">
          ${safe(member.name)}
        </button>
      `).join("")
      : DEFAULT_FRIENDS.map(name => `
        <button class="person" disabled>${safe(name)}</button>
      `).join("");
  }

  const friendsEl = el("friends");
  if (friendsEl) {
    friendsEl.innerHTML = members.length
      ? members.map(member => `
        <div class="pill">
          <strong>${safe(member.name)}</strong>
        </div>
      `).join("")
      : `<div class="empty">loading people.</div>`;
  }

  const splitBetweenEl = el("split-between");
  if (splitBetweenEl) {
    splitBetweenEl.innerHTML = members.length
      ? members.map(member => `
        <label class="check-row">
          <input type="checkbox" value="${member.id}" checked>
          <span>${safe(member.name)}</span>
        </label>
      `).join("")
      : `<div class="empty">loading split options.</div>`;
  }

  const balances = calculateBalances();

  const balancesEl = el("balances");
  if (balancesEl) {
    balancesEl.innerHTML = members.length
      ? members.map(member => {
        const amount = balances[member.id] || 0;

        return `
          <div class="pill">
            <span>${safe(member.name)}</span>
            <span class="${amount >= 0 ? "money-positive" : "money-negative"}">
              ${amount >= 0 ? "gets" : "owes"} ${money(Math.abs(amount))}
            </span>
          </div>
        `;
      }).join("")
      : `<div class="empty">loading balances.</div>`;
  }

  const settlements = calculateSettlements();

  const settlementsEl = el("settlements");
  if (settlementsEl) {
    settlementsEl.innerHTML = settlements.length
      ? settlements.map(settlement => `
        <div class="pill">
          <span><strong>${safe(memberName(settlement.fromId))}</strong> pays <strong>${safe(memberName(settlement.toId))}</strong></span>
          <span class="amount">${money(settlement.amount)}</span>
        </div>
      `).join("")
      : `<div class="empty">all settled, or no shared purchases yet.</div>`;
  }

  const purchasesEl = el("purchases");
  if (purchasesEl) {
    purchasesEl.innerHTML = expenses.length
      ? expenses.map(expense => {
        const expenseSplits = splits.filter(split => split.expense_id === expense.id);
        const splitNames = expenseSplits.map(split => safe(memberName(split.member_id))).join(", ");

        return `
          <div class="purchase-card">
            <div class="purchase-top">
              <div>
                <strong>${safe(expense.description)}</strong>
                <div class="small muted">paid by ${safe(memberName(expense.payer_member_id))} · split with ${splitNames}</div>
                ${expense.receipt_url ? `<a class="receipt-link" href="${safe(expense.receipt_url)}" target="_blank" rel="noopener">view receipt</a>` : ""}
              </div>
              <div class="right-actions">
                <div class="amount">${money(expense.amount)}</div>
                <button class="danger" onclick="deletePurchase('${expense.id}')">delete</button>
              </div>
            </div>
          </div>
        `;
      }).join("")
      : `<div class="empty">no purchases yet.</div>`;
  }
}

function addListenerIfExists(id, eventName, callback) {
  const node = el(id);
  if (node) {
    node.addEventListener(eventName, callback);
  }
}

function bindEvents() {
  addListenerIfExists("add-purchase-button", "click", addPurchase);
  addListenerIfExists("select-all-button", "click", selectAllSplit);
  addListenerIfExists("clear-split-button", "click", clearSplit);
  addListenerIfExists("refresh-button", "click", refreshData);
}

window.addEventListener("load", async () => {
  bindEvents();
  render();
  await loadDefaultTrip();
});
