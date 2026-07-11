<?php
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

$db = mm_db();
if ($db === null) {
    mm_json_response(500, ['error' => 'Orders are unavailable right now. Please try again shortly.']);
    exit;
}
mm_ensure_runtime_tables();

$user = mm_current_user();
$orderRef = 'HB-' . strtoupper(bin2hex(random_bytes(5)));

try {
    $stmt = $db->prepare('INSERT INTO book_orders (order_ref, book_id, book_title, price, email, user_id, status, created_at)
                          VALUES (:order_ref, :book_id, :book_title, :price, :email, :user_id, :status, UTC_TIMESTAMP())');
    $stmt->execute([
        ':order_ref' => $orderRef,
        ':book_id' => substr($bookId, 0, 120),
        ':book_title' => substr($bookTitle, 0, 255),
        ':price' => $price,
        ':email' => substr($email, 0, 190),
        ':user_id' => is_array($user) ? (int) $user['id'] : null,
        ':status' => 'pending',
    ]);
} catch (Throwable $error) {
    mm_json_response(500, ['error' => 'Unable to record this order right now. Please try again.']);
    exit;
}

mm_json_response(200, [
    'status' => 'ok',
    'orderRef' => $orderRef,
    'message' => 'Order recorded. Real payment processing is not connected yet — we will email you at ' . $email . ' with purchase instructions once billing is live.',
]);
