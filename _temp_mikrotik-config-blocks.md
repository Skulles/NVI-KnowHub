# MikroTik — блоки конфига (без очистки)

> Временный файл для инструкции.  
> `n` — последний октет IP роутера (пример: при `n=42` адрес `10.0.0.42/24`, сеть `10.0.0.0/24`).

---

## 1. LAN — только Ethernet

Назначает статический IP на `ether1`. Используется, если Wi‑Fi не нужен.

```routeros
/ip address add address=10.0.0.n/24 network=10.0.0.0 interface=ether1
```

---

## 2. LAN — Ethernet + Wi‑Fi

Объединяет `ether1` и `wlan1` в мост, поднимает точку доступа WPA2 и вешает IP на мост.

```routeros
/interface bridge add name=bridge-lan
/interface bridge port add bridge=bridge-lan interface=ether1
/interface bridge port add bridge=bridge-lan interface=wlan1
/interface wireless security-profiles add name=ltap-wifi mode=dynamic-keys authentication-types=wpa2-psk wpa2-pre-shared-key="ПАРОЛЬ_WIFI"
/interface wireless set [find default-name=wlan1] disabled=no mode=ap-bridge band=2ghz-b/g/n ssid="ИМЯ_WIFI" security-profile=ltap-wifi
/ip address add address=10.0.0.n/24 network=10.0.0.0 interface=bridge-lan
```

**Скрытая сеть:** к команде `wireless set` добавить ` hide-ssid=yes`.

---

## 3. NAT — выход в интернет через LTE

Маскарадинг всего исходящего трафика через интерфейс `lte1`.

```routeros
/ip firewall nat add chain=srcnat out-interface=lte1 action=masquerade
```

---

## 4. Безопасность — интерфейсы и сервисы

Ограничивает управление роутером LAN-интерфейсом, отключает лишние сервисы и IPv6.  
`LAN_IF` — `ether1` (без Wi‑Fi) или `bridge-lan` (с Wi‑Fi).

```routeros
/interface list add name=LAN
/interface list member add list=LAN interface=LAN_IF
/tool mac-server set allowed-interface-list=LAN
/tool mac-server mac-winbox set allowed-interface-list=LAN
/ip neighbor discovery-settings set discover-interface-list=LAN
/ipv6 settings set disable-ipv6=yes
/ip service set telnet disabled=yes
/ip service set ftp disabled=yes
/ip service set www disabled=yes
/ip service set api disabled=yes
/ip service set api-ssl disabled=yes
/ip service set winbox address=10.0.0.0/24,192.168.3.0/24,172.33.11.0/24,10.33.12.0/24
/ip service set ssh address=10.0.0.0/24,192.168.3.0/24,172.33.11.0/24,10.33.12.0/24
```

---

## 5. Firewall — входящий трафик (input)

Базовые правила: пропуск установленных соединений, отброс мусора, доступ с LAN, всё остальное — drop.

```routeros
/ip firewall filter add chain=input action=accept connection-state=established,related
/ip firewall filter add chain=input action=drop connection-state=invalid
/ip firewall filter add chain=input action=accept src-address=10.0.0.0/24
/ip firewall filter add chain=input action=drop
```

### 5a. Дополнительно для IPsec

Выполнять после базовых правил input, **перед** финальным `drop`.  
Разрешает IKE (UDP 500/4500), ESP и трафик из списка `lan-moscow`.

```routeros
/ip firewall filter add chain=input action=accept src-address-list=lan-moscow
/ip firewall filter add chain=input action=accept protocol=udp dst-port=500,4500
/ip firewall filter add chain=input action=accept protocol=ipsec-esp
```

> Если в скрипте от техподдержки уже есть аналогичные правила input — используйте их вместо строк выше.

---

## 6. Firewall — транзит (forward)

Минимальная фильтрация транзитного трафика.

```routeros
/ip firewall filter add chain=forward action=accept connection-state=established,related
/ip firewall filter add chain=forward action=drop connection-state=invalid
```

---

## 7. Завершение — имя и пароль

```routeros
/system identity set name="owlNNNN"
/user set admin password=НОВЫЙ_ПАРОЛЬ
```

`owlNNNN` — имя устройства по OWL ID (4 цифры).

---

## Порядок применения

1. LAN (блок 1 или 2)  
2. NAT (блок 3)  
3. **IPsec-команды от техподдержки** *(не входят в этот файл)*  
4. Безопасность (блок 4)  
5. Firewall input (блок 5, при IPsec — + блок 5a)  
6. Firewall forward (блок 6)  
7. Имя и пароль (блок 7)
