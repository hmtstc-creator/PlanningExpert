# SOP işleyicisi (docs/wiki/12-sop-olusturma.md): Node + ffmpeg. Kod imaja girmez,
# depo salt okunur bağlanır (web gibi); yayında yalnız yeniden başlatılır.
FROM node:22-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
CMD ["node", "sop-worker/index.mjs"]
