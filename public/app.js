const restaurantsEl = document.getElementById('restaurants');
const restaurantSelect = document.getElementById('restaurantId');
const tableSelect = document.getElementById('tableId');
const form = document.getElementById('booking-form');
const rules = document.getElementById('rules');

let restaurants = [];

const loadRestaurants = async () => {
  const response = await fetch('/api/restaurants');
  restaurants = await response.json();

  restaurantsEl.innerHTML = '';
  restaurantSelect.innerHTML = '<option value="">Select restaurant</option>';

  restaurants.forEach((r) => {
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `<strong>${r.name}</strong><br>${r.address}<br>${r.cuisine}<br>Hours: ${r.openingHours}`;
    restaurantsEl.appendChild(card);

    const option = document.createElement('option');
    option.value = r._id;
    option.textContent = `${r.name} (${r.depositRequired ? `Deposit Rs ${r.depositAmount}` : 'No deposit'})`;
    restaurantSelect.appendChild(option);
  });
};

const loadTables = async () => {
  const restaurantId = restaurantSelect.value;
  const date = document.getElementById('date').value;
  const time = document.getElementById('time').value;
  if (!restaurantId || !date || !time) return;

  const response = await fetch(`/api/restaurants/${restaurantId}/tables?date=${date}&time=${time}`);
  const tables = await response.json();
  tableSelect.innerHTML = '<option value="">Select table</option>';
  tables.filter((t) => t.isAvailable).forEach((t) => {
    const option = document.createElement('option');
    option.value = t._id;
    option.textContent = `Table ${t.number} (${t.seats} seats)`;
    tableSelect.appendChild(option);
  });

  const selected = restaurants.find((r) => r._id === restaurantId);
  rules.textContent = selected?.depositRequired
    ? `Deposit required: Rs ${selected.depositAmount}. Full refund if cancelled 24+ hours before booking.`
    : 'No deposit required. Cancellation is free.';
};

restaurantSelect.addEventListener('change', loadTables);
document.getElementById('date').addEventListener('change', loadTables);
document.getElementById('time').addEventListener('change', loadTables);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    restaurantId: restaurantSelect.value,
    tableId: tableSelect.value,
    name: document.getElementById('name').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    date: document.getElementById('date').value,
    time: document.getElementById('time').value,
    guests: Number(document.getElementById('guests').value)
  };

  if (!payload.restaurantId || !payload.tableId || !payload.name || !payload.phone) {
    return alert('Please fill all fields.');
  }

  const response = await fetch('/api/reservations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Failed to create booking');

  document.getElementById('confirmation').classList.remove('hidden');
  document.getElementById('confirmation-text').textContent = JSON.stringify(data, null, 2);
  document.getElementById('qrcode').innerHTML = '';
  new QRCode(document.getElementById('qrcode'), {
    text: `reservation:${data.reservation._id}`,
    width: 140,
    height: 140
  });
});

loadRestaurants();
