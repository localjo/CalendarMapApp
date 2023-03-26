import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Alert, Button, Platform, SafeAreaView, Linking } from 'react-native';
import MapView, { Marker, LatLng } from 'react-native-maps';
import * as Calendar from 'expo-calendar';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format, addDays } from 'date-fns';
import Geocoder from 'react-native-geocoding';
import uniqBy from 'lodash/uniqBy';

if (!process.env.GOOGLE_MAPS_API_KEY) {
  throw new Error('GOOGLE_MAPS_API_KEY environment variable is required.');
}
Geocoder.init(process.env.GOOGLE_MAPS_API_KEY);

type EventWithLocation = Calendar.Event & { geoLocation: LatLng | null };

export default function CalendarMap() {
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(addDays(new Date(), 7));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerType, setDatePickerType] = useState<'start' | 'end'>('start');
  const [region, setRegion] = useState({
    latitude: -8.5,
    longitude: 115.2,
    latitudeDelta: 0.1,
    longitudeDelta: 0.1,
  });
  const [calendarEvents, setCalendarEvents] = useState<EventWithLocation[]>([]);

  useEffect(() => {
    (async () => {
      await checkAndUpdateEvents();
      await checkAndUpdateLocation();
    })();
  }, []);

  async function requestCalendarPermission() {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status === 'granted') {
      await fetchCalendarEvents();
    } else {
      alert('Calendar permission is required for this app to work.');
    }
  }

  async function requestLocationPermission() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      await updateLocation();
    } else {
      Alert.alert('Location permission is required for this app to work.');
    }
  }

  async function updateLocation() {
    const location = await Location.getCurrentPositionAsync({});
    setRegion({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      latitudeDelta: region.latitudeDelta,
      longitudeDelta: region.longitudeDelta,
    });
  }

  function parseLocation(location?: string | null): { latitude: number; longitude: number } | null {
    if (!location) return null;

    const parts = location.split(',');
    if (parts.length === 2) {
      const latitude = parseFloat(parts[0]);
      const longitude = parseFloat(parts[1]);

      if (!isNaN(latitude) && !isNaN(longitude)) {
        return { latitude, longitude };
      }
    }
    return null;
  }

  async function checkAndUpdateLocation() {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') {
      await updateLocation();
    } else {
      await requestLocationPermission();
    }
  }

  async function checkAndUpdateEvents() {
    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status === 'granted') {
      await fetchCalendarEvents();
    } else {
      await requestCalendarPermission();
    }
  }

  function onStartDateChange(event: any, selectedDate: Date | undefined) {
    if (selectedDate) {
      setStartDate(selectedDate);
      setShowDatePicker(false);
      fetchCalendarEvents();
    } else {
      setShowDatePicker(false);
    }
  }

  function onEndDateChange(event: any, selectedDate: Date | undefined) {
    if (selectedDate) {
      setEndDate(selectedDate);
      setShowDatePicker(false);
      fetchCalendarEvents();
    } else {
      setShowDatePicker(false);
    }
  }

  async function getLocationFromAddress(address: string): Promise<{ latitude: number; longitude: number } | null> {
    try {
      const response = await Geocoder.from(address);
      const location = response.results[0].geometry.location;
      return { latitude: location.lat, longitude: location.lng };
    } catch (error) {
      console.warn('Error getting location from address:', address);
      return null;
    }
  }

  async function fetchCalendarEvents() {
    try {
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const events = await Calendar.getEventsAsync(
        calendars.map(calendar => calendar.id),
        startDate,
        endDate
      );
      const geocodedEvents = await Promise.all(
        events.map(async event => {
          if (!event.location) return { ...event, geoLocation: null };
          const geoLocation = await getLocationFromAddress(event.location);
          return { ...event, geoLocation };
        })
      );

      const eventsWithLocation = geocodedEvents.filter(event => event.geoLocation);

      setCalendarEvents(eventsWithLocation);
    } catch (error) {
      if (error instanceof Error) {
        Alert.alert('Error fetching calendar events:', error.message);
      } else {
        Alert.alert('Error fetching calendar events:', 'An unknown error occurred.');
      }
    }
  }

  function toggleDatePicker(type: 'start' | 'end') {
    setShowDatePicker(!showDatePicker);
    setDatePickerType(type);
  }

  const uniqueCalendarEvents = uniqBy(calendarEvents, 'id');

  async function onMarkerPress(event: EventWithLocation) {
    const eventId = event.id;
    const calendarID = event.calendarId;
    const calendarLink = `${calendarID}&event=${eventId}`;
    if (eventId) {
      console.log('Opening calendar event:', calendarLink);
      // BUG: iOS support for opening calendar events by ID seems to be broken
      const eventUrl = Platform.select({
        ios: `calshow:${calendarLink}`,
        android: `content://com.android.calendar/events/${calendarLink}`,
      });

      if (!eventUrl) return;

      const supported = await Linking.canOpenURL(eventUrl);

      if (supported) {
        await Linking.openURL(eventUrl);
      } else {
        Alert.alert('Unable to open the Calendar app.');
      }
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.datePickerContainer}>
        <Button title={`Start Date: ${format(startDate, 'MM/dd/yyyy')}`} onPress={() => toggleDatePicker('start')} />
        {showDatePicker && datePickerType === 'start' && (
          <DateTimePicker value={startDate} mode='date' onChange={onStartDateChange} display={Platform.OS === 'ios' ? 'inline' : 'default'} />
        )}
        <Button title={`End Date: ${format(endDate, 'MM/dd/yyyy')}`} onPress={() => toggleDatePicker('end')} />
        {showDatePicker && datePickerType === 'end' && (
          <DateTimePicker value={endDate} mode='date' onChange={onEndDateChange} display={Platform.OS === 'ios' ? 'inline' : 'default'} />
        )}
      </View>
      <MapView style={styles.map} region={region} showsUserLocation={true}>
        {uniqueCalendarEvents.map((event, index) => {
          const geoLocation = event.geoLocation;

          if (geoLocation) {
            return (
              <Marker key={event.id} coordinate={geoLocation} title={event.title} description={event.location} onPress={() => onMarkerPress(event)} />
            );
          }

          return null;
        })}
      </MapView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    flex: 1,
  },
  datePickerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  map: {
    width: '100%',
    flex: 1,
  },
});
