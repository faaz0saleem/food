<?php
// Read-only: the current user's daily AI credit balance, for the nav badge and
// chat display. Consumes nothing.
require_once __DIR__ . '/_config.php';

mm_handle_options();

mm_json_response(200, array_merge(['status' => 'ok'], mm_credits_status()));
