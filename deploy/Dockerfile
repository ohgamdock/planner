FROM node:20-alpine
WORKDIR /app
COPY index.html style.css app.js merge.js server.js manifest.webmanifest sw.js ./
COPY assets ./assets
COPY downloads ./downloads
ENV PORT=4310
ENV PLANNER_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 4310
CMD ["node", "server.js"]
