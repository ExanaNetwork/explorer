### Setup of exana-rpc-explorer on Ubuntu 20.04 server

First install certbot on your machine by following these instructions:

    https://certbot.eff.org/instructions?ws=nginx&os=snap

Then execute this commands from terminal:

```bash
curl -sSL https://deb.nodesource.com/gpgkey/nodesource.gpg.key | sudo apt-key add -
VERSION=node_22.x
echo "deb https://deb.nodesource.com/$VERSION nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
echo "deb-src https://deb.nodesource.com/$VERSION nodistro main" | sudo tee -a /etc/apt/sources.list.d/nodesource.list
sudo apt update
sudo apt upgrade
sudo apt install git software-properties-common nginx gcc g++ make nodejs redis redis-server
sudo npm install pm2 --global
apt install python-certbot-nginx
```

Copy content from [./exana-explorer.conf](./exana-explorer.conf) into `/etc/nginx/sites-available/exana-explorer.conf`


```bash
certbot --nginx -d exana-explorer.com #use your domain name here
cd /home/exana
git clone https://github.com/ExanaNetwork/explorer.git
cd /home/exana/explorer
npm install
pm2 start bin/www --name "exana-rpc-explorer"
```

Before starting you should probably have a look at `.env-sample` to have an idea on how to configure/customise
your explorer instance.

If you want your explorer being able to show transactions with a feerate lower than 1 sat/byte you should
configure your full nodes to accept those on its mempool. To do that if you need to add this parameter to your exana.conf:


```ini
minlimitertxfee=0.5
```
This would let your node to accept transactions in its mempool with a feerate as low as 0.5 sat/byte.
You can of course go lower than that at the expense of using more resource to bookkeep the mempool.
