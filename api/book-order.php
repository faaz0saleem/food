<?php
// Book order endpoint. Records an order (PDF or physical), bundles a Student
// subscription with every book, and — if the buyer's email matches an account —
// activates that plan immediately. Payment capture is a separate (not-yet-live)
// step; this creates the pending order and the confirmation the shop shows.
require_once __DIR__ . '/_config.php';

mm_handle_options();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
mm_require_rate_limit(mm_rate_limit_key($body), 10, 60);

$bookId = trim((string) ($body['bookId'] ?? ''));
$bookTitle = trim((string) ($body['bookTitle'] ?? ''));
$price = (float) ($body['price'] ?? 0);
$email = strtolower(trim((string) ($body['email'] ?? '')));
$format = strtolower(trim((string) ($body['format'] ?? 'pdf')));
$fullName = trim((string) ($body['name'] ?? ''));
$phone = trim((string) ($body['phone'] ?? ''));
$address = trim((string) ($body['address'] ?? ''));
$quantity = max(1, min(20, (int) ($body['quantity'] ?? 1)));

if ($format !== 'pdf' && $format !== 'physical') { $format = 'pdf'; }

if ($bookId === '' || $bookTitle === '') {
    mm_json_response(400, ['error' => 'bookId and bookTitle are required.']);
    exit;
}
if ($price <= 0) {
    mm_json_response(400, ['error' => 'A valid price is required.']);
    exit;
}
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    mm_json_response(400, ['error' => 'Please enter a valid email.']);
    exit;
}
if ($fullName === '') {
    mm_json_response(400, ['error' => 'Please enter your name.']);
    exit;
}
if ($format === 'physical' && $address === '') {
    mm_json_response(400, ['error' => 'A shipping address is required for the physical book.']);
    exit;
}

$db = mm_db();
if ($db === null) {
    mm_json_response(500, ['error' => 'Orders are unavailable right now. Please try again shortly.']);
    exit;
}
mm_ensure_runtime_tables();

$user = mm_current_user();
$total = round($price * $quantity, 2);
$orderRef = 'HB-' . strtoupper(bin2hex(random_bytes(5)));

try {
    $stmt = $db->prepare('INSERT INTO book_orders
        (order_ref, book_id, book_title, price, email, user_id, format, full_name, shipping_address, phone, quantity, includes_plan, status, created_at)
        VALUES (:order_ref, :book_id, :book_title, :price, :email, :user_id, :format, :full_name, :shipping_address, :phone, :quantity, :includes_plan, :status, UTC_TIMESTAMP())');
    $stmt->execute([
        ':order_ref' => $orderRef,
        ':book_id' => substr($bookId, 0, 120),
        ':book_title' => substr($bookTitle, 0, 255),
        ':price' => $total,
        ':email' => substr($email, 0, 190),
        ':user_id' => is_array($user) ? (int) $user['id'] : null,
        ':format' => $format,
        ':full_name' => substr($fullName, 0, 160),
        ':shipping_address' => $format === 'physical' ? substr($address, 0, 2000) : null,
        ':phone' => substr($phone, 0, 40),
        ':quantity' => $quantity,
        ':includes_plan' => 'Student',
        ':status' => 'pending',
    ]);
} catch (Throwable $error) {
    mm_json_response(500, ['error' => 'Unable to record this order right now. Please try again.']);
    exit;
}

// Every book bundles a Student subscription. If the buyer already has an
// account (by email), activate it now so the perk is live immediately.
$planActivated = false;
try {
    $target = $user;
    if ($target === null) { $target = mm_find_user_by_email($email); }
    if (is_array($target)) {
        $db->prepare("UPDATE users SET plan_name = 'Student', plan_price = 5, plan_status = 'active', plan_started = UTC_TIMESTAMP() WHERE id = :id")
           ->execute([':id' => (int) $target['id']]);
        $planActivated = true;
    }
} catch (Throwable $e) { /* non-fatal */ }

$delivery = $format === 'pdf'
    ? 'Your PDF will be emailed to ' . $email . ' within 5 hours.'
    : 'Your physical book will be shipped to the address you provided.';

mm_json_response(200, [
    'status' => 'ok',
    'orderRef' => $orderRef,
    'format' => $format,
    'total' => $total,
    'includesPlan' => 'Student',
    'planActivated' => $planActivated,
    'delivery' => $delivery,
    'message' => 'Order placed! ' . $delivery . ' Every book includes a Student subscription'
        . ($planActivated ? ' — now active on your account.' : ' — sign in with ' . $email . ' to use it.')
        . ' Payment isn\'t connected yet, so this order is reserved; we\'ll email you to complete payment once billing is live.',
]);
