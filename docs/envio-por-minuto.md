# Envio no minuto exato

No painel do aviso você escolhe o horário com hora e minuto (por exemplo 13:51).
O que decide *quando o servidor olha* é o acionador:

- **Padrão (Vercel gratuita):** uma verificação por hora, de 6h a 20h. O e-mail sai na primeira verificação depois do horário escolhido, então pode atrasar até cerca de 1 hora. Um horário depois das 20:00 não é verificado nesse modo.
- **Minuto a minuto (recomendado se o minuto importar):** o workflow `.github/workflows/envio-faltas-por-minuto.yml` chama o sistema de 5 em 5 minutos. Para ativar, no GitHub: Settings → Secrets and variables → Actions → aba Variables, crie `APP_URL` com o endereço oficial do painel. Se a Vercel usa `CRON_SECRET`, crie o mesmo valor como secret `CRON_SECRET`. O GitHub pode atrasar alguns minutos em horários de pico; chamar de novo nunca reenvia (cada área recebe uma vez por semana).
