<?php

declare(strict_types=1);

/**
 * phpMyAdmin configuration for Hungter deployment.
 * Use cookie auth so database passwords are not stored in this file.
 */
$cfg['blowfish_secret'] = '8c75e44ac0d6cd333d461cf0937f7b9f84a9e773eaa9e1a93522836414c9e0d7';

$i = 1;
$cfg['Servers'][$i]['auth_type'] = 'cookie';
$cfg['Servers'][$i]['host'] = getenv('MYSQL_HOST') ?: 'localhost';
$cfg['Servers'][$i]['port'] = (int) (getenv('MYSQL_PORT') ?: 3306);
$cfg['Servers'][$i]['compress'] = false;
$cfg['Servers'][$i]['AllowNoPassword'] = false;

$cfg['DefaultLang'] = 'en';
$cfg['ShowPhpInfo'] = true;
$cfg['CheckConfigurationPermissions'] = false;
$cfg['TempDir'] = __DIR__ . '/tmp';

