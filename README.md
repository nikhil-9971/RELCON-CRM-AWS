# RELCON-CRM-AWS
RELCON DATA BASE

## Environment file kahan banani hai?

Backend ke liye `.env` file **`backend/` folder ke andar** banegi:

```bash
cp backend/.env.example backend/.env
```

Phir `backend/.env` me values bharni hain. `MAIL_TO_ADMIN` optional hai; agar set hoga to pending report mail admin ko jayega, warna `MAIL_TO` use hoga.
