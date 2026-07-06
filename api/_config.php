<?php

function mm_env_value(string $key, string $default = ''): string {
    $fromEnv = getenv($key);
    if ($fromEnv !== false && $fromEnv !== '') {
        return (string) $fromEnv;
    }

    $root = dirname(__DIR__);
    $envPath = $root . DIRECTORY_SEPARATOR . '.env';
    if (!is_file($envPath)) {
        return $default;
    }

    $lines = @file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return $default;
    }

    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '' || str_starts_with($trimmed, '#')) {
            continue;
        }

        $parts = explode('=', $trimmed, 2);
        if (count($parts) !== 2) {
            continue;
        }

        $name = trim($parts[0]);
        $value = trim($parts[1]);
        if ($name !== $key) {
            continue;
        }

        if ((str_starts_with($value, '"') && str_ends_with($value, '"')) || (str_starts_with($value, "'") && str_ends_with($value, "'"))) {
            $value = substr($value, 1, -1);
        }

        return $value;
    }

    return $default;
}

function mm_json_response(int $statusCode, array $payload): void {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET,POST,OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type,Authorization');
    echo json_encode($payload);
}

function mm_read_json_body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return [];
    }

    return $decoded;
}

function mm_handle_options(): void {
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        mm_json_response(204, ['status' => 'ok']);
        exit;
    }
}

function mm_normalize_history(mixed $history): array {
    if (!is_array($history)) {
        return [];
    }

    $normalized = [];
    foreach ($history as $item) {
        if (!is_array($item)) {
            continue;
        }
        $role = isset($item['role']) && $item['role'] === 'assistant' ? 'assistant' : 'user';
        $content = trim((string) ($item['content'] ?? ''));
        if ($content === '') {
            continue;
        }
        $normalized[] = ['role' => $role, 'content' => $content];
    }

    return array_slice($normalized, -12);
}

function mm_normalize_attachments(mixed $attachments): array {
    if (!is_array($attachments)) {
        return [];
    }

    $normalized = [];
    foreach ($attachments as $item) {
        if (!is_array($item)) {
            continue;
        }

        $normalized[] = [
            'name' => substr((string) ($item['name'] ?? 'attachment'), 0, 120),
            'type' => substr((string) ($item['type'] ?? 'application/octet-stream'), 0, 120),
            'kind' => (isset($item['kind']) && $item['kind'] === 'image') ? 'image' : 'file',
            'textContent' => substr((string) ($item['textContent'] ?? ''), 0, 12000),
            'imageDataUrl' => substr((string) ($item['imageDataUrl'] ?? ''), 0, 250000),
            'size' => (int) ($item['size'] ?? 0),
        ];
    }

    return array_slice($normalized, 0, 5);
}

function mm_build_final_message(string $message, array $attachments): string {
    $message = trim($message);
    if (count($attachments) === 0) {
        return $message;
    }

    $parts = [];
    foreach ($attachments as $attachment) {
        $header = '[Attachment: ' . ($attachment['name'] ?? 'attachment') . ' | ' . ($attachment['type'] ?? 'application/octet-stream') . ' | ' . (int) ($attachment['size'] ?? 0) . ' bytes]';
        if (($attachment['kind'] ?? 'file') === 'image' && !empty($attachment['imageDataUrl'])) {
            $parts[] = $header . "\nImage data URL provided by student (truncated):\n" . substr((string) $attachment['imageDataUrl'], 0, 1800);
            continue;
        }

        if (!empty($attachment['textContent'])) {
            $parts[] = $header . "\nFile text excerpt:\n" . (string) $attachment['textContent'];
            continue;
        }

        $parts[] = $header . "\nNo parseable text extracted.";
    }

    return $message . "\n\nStudent uploaded files/images for analysis:\n" . implode("\n\n", $parts);
}
