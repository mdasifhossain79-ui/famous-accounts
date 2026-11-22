-- Edit the password, then run:  mysql -u root -p < setup-mysql-user.sql
CREATE DATABASE IF NOT EXISTS famous_accounts CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'famous'@'localhost' IDENTIFIED BY 'Asif@21490!';
GRANT ALL PRIVILEGES ON famous_accounts.* TO 'famous'@'localhost';
FLUSH PRIVILEGES;
