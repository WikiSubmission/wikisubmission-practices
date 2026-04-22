# WikiSubmission Practices

Public API for Submission practices.

## Deployment

This project now includes a production `Dockerfile` for Dockerfile-based deployments in Coolify.

### Coolify

- Set the build type to use the repository `Dockerfile`.
- Expose the service as an HTTP app and let Coolify inject the port via `PORT`.
- Configure `GOOGLE_API_KEY` in Coolify. The app exits on startup if it is missing.
- `PORT` is optional because the server defaults to `8080`.
- `SUPABASE_URL` and `SUPABASE_API_KEY` are not required for the currently registered routes.

### Local Docker

```bash
docker build -t wikisubmission-practices .
docker run --rm -p 8080:8080 -e GOOGLE_API_KEY=your-key wikisubmission-practices
```

## Endpoints

### Prayer Times

```
https://practices.wikisubmission.org/prayer-times/{LOCATION}
```

Returns live prayer times data for given location query (which can be a city, landmark, zip code, coordinate, etc).

## Todo

To be expanded with more practices.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE.md) file for more information.

## Contact

Email: developer@wikisubmission.org
