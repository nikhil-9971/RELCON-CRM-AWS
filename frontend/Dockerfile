FROM nginx:alpine
RUN rm -rf /usr/share/nginx/html/*
COPY html/ /usr/share/nginx/html/
COPY assets/ /usr/share/nginx/html/assets/
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chmod -R 755 /usr/share/nginx/html/
EXPOSE 80
CMD ["/entrypoint.sh"]
